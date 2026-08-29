import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pc from 'picocolors'
import { countAtOrAbove, DEFAULT_FAIL_ON, type ImpactLevel } from '../audit/impact.ts'
import { formatConsoleReport } from '../audit/report/console.ts'
import type { PageAudit } from '../audit/runners/jsdom.ts'

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
import { type CrawlCommandOptions, resolvePages } from './pages.ts'

export const OUTPUT_FORMATS = ['console', 'json', 'sarif', 'html'] as const

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value)
}

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
  const { pages, origin, label, cleanup } = resolved
  // try/finally rather than a call before each return: auto-detection may have
  // started the project's server, and leaving it running would hold the process
  // open after the report is written.
  try {
    const engineNote = await describeEngine(pages, options)
    process.stderr.write(
      pc.dim(
        `Auditing ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} in ${label}${engineNote}…\n`,
      ),
    )

    // An explicit --base-url still wins; the crawl's own origin is the default, so
    // a fetched page is audited under the URL it was actually fetched from.
    const effectiveBaseUrl: string | undefined = options.baseUrl ?? origin

    const runnerOptions = {
      // The audited project, so the browser runner resolves Playwright from
      // there rather than from wherever npx unpacked this package.
      cwd: options.cwd ?? process.cwd(),
      // An explicit --base-url still wins; the crawl's own origin is the default
      // so that a fetched page is audited under the URL it was fetched from.
      ...(effectiveBaseUrl === undefined ? {} : { baseUrl: effectiveBaseUrl }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }

    let audits: PageAudit[]
    if (options.browser) {
      const { BrowserUnavailableError, runBrowserAudit } = await import(
        '../audit/runners/playwright.ts'
      )
      try {
        // No directory when the pages were crawled: they are audited at the URL
        // they came from, not served back out of a copy on disk.
        audits = await runBrowserAudit(
          options.url === undefined ? dir : undefined,
          pages,
          runnerOptions,
        )
      } catch (cause) {
        // Playwright missing is a setup problem with a specific fix, not a crash.
        if (cause instanceof BrowserUnavailableError) {
          process.stderr.write(`${pc.red('error')} ${cause.message}\n`)
          return { audits: [], exitCode: 2 }
        }
        throw cause
      }
    } else {
      const { runPooledAudit } = await import('../audit/runners/pool.ts')
      audits = await runPooledAudit(pages, {
        ...runnerOptions,
        ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      })
    }

    const failOn = options.failOn ?? DEFAULT_FAIL_ON

    if (options.baseline) {
      const applied = await acceptBaseline(audits, options)
      if (!applied) return { audits, exitCode: 2 }
      audits = applied
    }

    // label, not dir: it is what the run actually audited. dir is undefined
    // under auto-detection, and was the unused ./dist default under --url,
    // which put a directory nobody read into the report.
    await emit(audits, label, failOn, options)

    // A page that could not be audited is not a clean page. Exiting 0 here would
    // hand back a pass for markup nothing ever looked at, so it is reported as a
    // failed run rather than as a verdict.
    const unaudited = audits.filter((audit) => audit.error)
    if (unaudited.length > 0) {
      process.stderr.write(
        `${pc.red('error')} ${unaudited.length} of ${audits.length} pages could not be audited\n`,
      )
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
      process.stderr.write(pc.dim(`Baseline accepted ${outcome.accepted} violating elements\n`))
    }
    // A baseline that no longer matches is the good case — it means things were
    // fixed — but only if somebody is told to delete the entries. Entries for
    // pages this run did not audit are not counted here, so the advice is safe
    // to follow after a run narrowed by --include.
    if (outcome.stale.length > 0) {
      const count = outcome.stale.length
      process.stderr.write(
        pc.dim(
          `${count} baseline ${count === 1 ? 'entry no longer matches' : 'entries no longer match'} and can be removed\n`,
        ),
      )
    }
    if (outcome.expired.length > 0) {
      process.stderr.write(
        pc.yellow(
          `${outcome.expired.length} baseline entries have expired and no longer suppress anything\n`,
        ),
      )
    }

    return outcome.audits
  } catch (cause) {
    if (cause instanceof BaselineError) {
      process.stderr.write(`${pc.red('error')} ${cause.message}\n`)
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
  options: AuditCommandOptions,
): Promise<void> {
  const format = options.format ?? 'console'
  const toFile = typeof options.output === 'string'

  const body = await renderReport(audits, dir, failOn, format, toFile, options)

  if (!options.output) {
    process.stdout.write(body)
    return
  }

  // Against the same working directory as --baseline, rather than the process's:
  // a caller that says where relative paths start means it for all of them.
  const target = path.resolve(options.cwd ?? process.cwd(), options.output)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, body, 'utf8')
  process.stderr.write(pc.dim(`Report written to ${options.output}\n`))
}

async function renderReport(
  audits: readonly PageAudit[],
  /** What was audited: a build directory, or a crawl's entry URL. */
  dir: string,
  failOn: ImpactLevel,
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
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        }),
      )
    }
    case 'sarif': {
      const { buildSarifReport, serialiseSarifReport } = await import('../audit/report/sarif.ts')
      return serialiseSarifReport(buildSarifReport(audits, { directory: dir }))
    }
    case 'html': {
      const { buildHtmlReport } = await import('../audit/report/html.ts')
      const { buildRouteMap: mapRoutes, sourceFor: lookup } = await import('../audit/routes.ts')
      const { buildComponentIndex: indexSource, componentFor: findComponent } = await import(
        '../audit/component.ts'
      )
      const routeMap = await mapRoutes(options.cwd ?? process.cwd())
      const sourceIndex = await indexSource(options.cwd ?? process.cwd())
      return buildHtmlReport(audits, {
        sourceFor: (page) => lookup(routeMap, page),
        componentFor: (html) => findComponent(sourceIndex, html),
        directory: dir,
        failOn,
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      })
    }
    case 'console': {
      // Best-effort: a project using no convention this recognises gets the
      // report it always got, with no source column.
      const { buildRouteMap, sourceFor } = await import('../audit/routes.ts')
      const { buildComponentIndex, componentFor } = await import('../audit/component.ts')
      const routes = await buildRouteMap(options.cwd ?? process.cwd())
      const components = await buildComponentIndex(options.cwd ?? process.cwd())
      return `${formatConsoleReport(audits, {
        dir,
        failOn,
        sourceFor: (page) => sourceFor(routes, page),
        componentFor: (html) => componentFor(components, html),
        ...(options.perPage ? { perPage: true } : {}),
        ...(options.manual ? { manual: true } : {}),
        ...(toFile ? { color: false } : {}),
      })}\n`
    }
  }
}
