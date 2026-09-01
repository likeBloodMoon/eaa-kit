import { countAtOrAbove, DEFAULT_FAIL_ON, type ImpactLevel } from '../audit/impact.ts'
import { formatConsoleReport } from '../audit/report/console.ts'
import type { PageAudit } from '../audit/runners/jsdom.ts'
import { count } from '../text.ts'

/**
 * The engines and the machine-readable reporters are imported where they are
 * used, not at the top of the file.
 *
 * jsdom costs 630 ms to load and axe-core another 94 ms, and a static import
 * here charges that to every invocation — `eaa-kit statement`, `--help` and a
 * mistyped flag included, none of which parse a single page. The audit path
 * pays the same cost either way, a few milliseconds later.
 */

import type { CollectedPage } from '../audit/collect.ts'
import { type RunCompleteness, runCompleteness } from '../audit/completeness.ts'
import type { ComponentLocation } from '../audit/component.ts'
import { advise, emitDocument, fail, note, runEngine } from './command.ts'
import { type CrawlCommandOptions, resolvePages } from './pages.ts'

export const OUTPUT_FORMATS = ['console', 'json', 'sarif', 'html'] as const

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export interface AuditCommandOptions extends CrawlCommandOptions {
  include?: string[]
  exclude?: string[]
  baseUrl?: string
  /** Lowest impact that fails the run. Defaults to 'serious'. */
  failOn?: ImpactLevel
  /** Per-page timeout handed to the runner. */
  timeoutMs?: number
  /** What to emit. Defaults to the human-readable console report. */
  format?: OutputFormat
  /** Write the report here instead of stdout. Parent directories are created. */
  output?: string
  /** Audit in real Chromium instead of jsdom. Needs the playwright peer. */
  browser?: boolean
  /**
   * Worker threads the browserless engine may use. Defaults to what the page
   * count and the machine's core count justify; 1 audits in this process.
   */
  concurrency?: number
  /** Path to a baseline; violations it accounts for do not fail the run. */
  baseline?: string
  /** Where relative paths are resolved from. Defaults to the process's. */
  cwd?: string
  /** Never run the project's build or start its server to find something to audit. */
  noBuild?: boolean
  /** List every page and its result under the issues. */
  perPage?: boolean
  /** Print the manual check for each rule the engine could not evaluate. */
  manual?: boolean
  /** List every WCAG 2.2 A/AA criterion and what this run reached on it. */
  coverage?: boolean
}

export interface AuditCommandResult {
  audits: PageAudit[]
  /**
   * 0 clean, 1 violations at or above the --fail-on threshold, 2 the audit
   * could not run or could not finish.
   */
  exitCode: number
}

/**
 * `eaa-kit audit [dir]`.
 *
 * Writes progress to stderr and the report to stdout, so the report can be
 * piped somewhere without the chatter coming along.
 */
export async function runAuditCommand(
  /** Build directory, or undefined to work it out from the project. */
  dir: string | undefined,
  options: AuditCommandOptions = {},
): Promise<AuditCommandResult> {
  const resolved = await resolvePages(dir, options)
  if (!resolved) return { audits: [], exitCode: 2 }
  const { pages, origin, label, cleanup, directory, completeness: collection } = resolved
  // try/finally rather than a call before each return: auto-detection may have
  // started the project's server, and leaving it running would hold the process
  // open after the report is written.
  try {
    note(
      `Auditing ${count(pages.length, 'page')} in ${label}${await describeEngine(pages, options)}…`,
    )

    // An explicit --base-url still wins; the crawl's own origin is the default
    // so that a fetched page is audited under the URL it was fetched from.
    const baseUrl = options.baseUrl ?? origin

    let audits = await runEngine(pages, {
      cwd: options.cwd ?? process.cwd(),
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.browser ? { browser: true } : {}),
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      // The directory the pages were actually read from, not the one the
      // caller typed: under auto-detection nobody typed one, and passing
      // undefined told the browser runner these pages had been crawled. It
      // then skipped the loopback server and navigated Chromium to a bare
      // filesystem path, which is not a URL — so `eaa-kit audit --browser`
      // with no directory argument failed every page it was given.
      //
      // Still undefined for a real crawl: those pages are audited at the URL
      // they came from, not served back out of a copy on disk.
      ...(directory === undefined ? {} : { directory }),
    })
    if (!audits) return { audits: [], exitCode: 2 }

    const failOn = options.failOn ?? DEFAULT_FAIL_ON

    if (options.baseline) {
      const applied = await acceptBaseline(audits, options)
      if (!applied) return { audits, exitCode: 2 }
      audits = applied
    }

    const completeness = runCompleteness(audits, collection)

    // label, not dir: it is what the run actually audited. dir is undefined
    // under auto-detection, and was the unused ./dist default under --url,
    // which put a directory nobody read into the report.
    await emit(audits, label, failOn, completeness, options)

    // A page that could not be audited is not a clean page. Exiting 0 here would
    // hand back a pass for markup nothing ever looked at, so it is reported as a
    // failed run rather than as a verdict.
    const unaudited = audits.filter((audit) => audit.error)
    if (unaudited.length > 0) {
      fail(`${unaudited.length} of ${audits.length} pages could not be audited`)
      return { audits, exitCode: 2 }
    }

    return { audits, exitCode: countAtOrAbove(audits, failOn) > 0 ? 1 : 0 }
  } finally {
    await cleanup?.()
  }
}

/**
 * Move the violations the baseline accounts for out of the failing set.
 *
 * Returns undefined when the baseline could not be read, which the caller
 * turns into exit 2: a run asked to use a baseline it cannot find has not
 * measured what it was told to measure, and silently failing on everything
 * would be as wrong as silently passing.
 */
async function acceptBaseline(
  audits: PageAudit[],
  options: AuditCommandOptions,
): Promise<PageAudit[] | undefined> {
  const { applyBaseline, BaselineError, readBaseline } = await import('../audit/baseline.ts')

  try {
    const baseline = await readBaseline(options.baseline as string, options.cwd ?? process.cwd())
    const outcome = applyBaseline(audits, baseline)

    if (outcome.accepted > 0) {
      note(`Baseline accepted ${outcome.accepted} violating elements`)
    }
    // A baseline that no longer matches is the good case — it means things were
    // fixed — but only if somebody is told to delete the entries. Entries for
    // pages this run did not audit are not counted here, so the advice is safe
    // to follow after a run narrowed by --include.
    if (outcome.stale.length > 0) {
      const stale = outcome.stale.length
      const verb = stale === 1 ? 'entry no longer matches' : 'entries no longer match'
      note(`${stale} baseline ${verb} and can be removed`)
    }
    if (outcome.expired.length > 0) {
      advise(
        `${outcome.expired.length} baseline entries have expired and no longer suppress anything`,
      )
    }

    return outcome.audits
  } catch (cause) {
    if (cause instanceof BaselineError) {
      fail(cause.message)
      return undefined
    }
    throw cause
  }
}

/**
 * What the progress line says about the engine.
 *
 * The thread count is on it because it is the difference between a run that
 * looks stalled and one that is working, and because a user comparing two
 * timings deserves to know which one used the machine.
 */
async function describeEngine(
  pages: readonly CollectedPage[],
  options: AuditCommandOptions,
): Promise<string> {
  if (options.browser) return ' with Chromium'

  const { plannedWorkers } = await import('../audit/runners/pool.ts')
  const workers = options.concurrency ?? plannedWorkers(pages)
  return workers > 1 ? ` across ${workers} threads` : ''
}

/**
 * Emit the chosen format, to a file when --output is given and to stdout
 * otherwise. Colour is dropped when writing to a file, since escape codes in a
 * saved report are noise.
 */
async function emit(
  audits: readonly PageAudit[],
  dir: string,
  failOn: ImpactLevel,
  completeness: RunCompleteness,
  options: AuditCommandOptions,
): Promise<void> {
  const format = options.format ?? 'console'
  const toFile = typeof options.output === 'string'
  const body = await renderReport(audits, dir, failOn, completeness, format, toFile, options)

  // Against the same working directory as --baseline, rather than the process's:
  // a caller that says where relative paths start means it for all of them.
  await emitDocument(body, options.output, options.cwd ?? process.cwd())
  if (options.output !== undefined) note(`Report written to ${options.output}`)
}

async function renderReport(
  audits: readonly PageAudit[],
  /** What was audited: a build directory, or a crawl's entry URL. */
  dir: string,
  failOn: ImpactLevel,
  completeness: RunCompleteness,
  format: OutputFormat,
  toFile: boolean,
  options: AuditCommandOptions,
): Promise<string> {
  switch (format) {
    case 'json': {
      const { buildJsonReport, serialiseJsonReport } = await import('../audit/report/json.ts')
      return serialiseJsonReport(
        buildJsonReport(audits, {
          directory: dir,
          ...(options.url === undefined ? {} : { sourceKind: 'url' as const }),
          failOn,
          completeness,
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        }),
      )
    }
    case 'sarif': {
      const { buildSarifReport, serialiseSarifReport } = await import('../audit/report/sarif.ts')
      return serialiseSarifReport(buildSarifReport(audits, { directory: dir, completeness }))
    }
    case 'html': {
      const { buildHtmlReport } = await import('../audit/report/html.ts')
      const framework = await detectedFramework(options.cwd ?? process.cwd())
      return buildHtmlReport(audits, {
        ...(await sourceLookups(options.cwd ?? process.cwd(), audits)),
        directory: dir,
        failOn,
        completeness,
        ...(framework === undefined ? {} : { framework }),
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      })
    }
    case 'console': {
      const framework = await detectedFramework(options.cwd ?? process.cwd())
      return `${formatConsoleReport(audits, {
        ...(await sourceLookups(options.cwd ?? process.cwd(), audits)),
        dir,
        failOn,
        completeness,
        ...(options.perPage ? { perPage: true } : {}),
        ...(options.manual ? { manual: true } : {}),
        ...(options.coverage ? { coverage: true } : {}),
        ...(framework === undefined ? {} : { framework }),
        ...(toFile ? { color: false } : {}),
      })}\n`
    }
  }
}

/**
 * Where a page and a failing element were written, for the two reports that say
 * so. Best-effort: a project using no convention this recognises gets the
 * report it always got, with no source named.
 */
/** The registry id of whatever built this project, for framework-shaped advice. */
async function detectedFramework(cwd: string): Promise<string | undefined> {
  const { detectFramework } = await import('../audit/frameworks.ts')
  const { readPackageJson } = await import('../audit/project.ts')
  return (await detectFramework(cwd, await readPackageJson(cwd)))?.framework.id
}

async function sourceLookups(
  cwd: string,
  /** What the run found, which decides whether the component index is worth building. */
  audits: readonly PageAudit[],
): Promise<{
  sourceFor: (page: string) => string | undefined
  componentFor: (html: string) => ComponentLocation | undefined
}> {
  const { buildRouteMap, sourceFor } = await import('../audit/routes.ts')
  const routes = await buildRouteMap(cwd)

  // The component index reads the project's source — up to two thousand files —
  // to answer one question: which file a failing element was written in. A run
  // that found nothing to fix never asks it, and building it anyway cost every
  // clean audit around 450 ms and 20-odd MB on a mid-size project, scaling with
  // the source tree rather than with anything the run actually did.
  //
  // Both reports only reach for it from the issues view, which is built from
  // violations and from baseline-accepted findings. No elements there, no
  // lookups, nothing to index.
  if (!hasElementsToAttribute(audits)) {
    return { sourceFor: (page) => sourceFor(routes, page), componentFor: () => undefined }
  }

  const { buildComponentIndex, componentFor } = await import('../audit/component.ts')
  const components = await buildComponentIndex(cwd)
  return {
    sourceFor: (page) => sourceFor(routes, page),
    componentFor: (html) => componentFor(components, html),
  }
}

/** Whether any element will be listed, and so looked up against the source. */
function hasElementsToAttribute(audits: readonly PageAudit[]): boolean {
  return audits.some((audit) => audit.violations.length > 0 || (audit.accepted?.length ?? 0) > 0)
}
