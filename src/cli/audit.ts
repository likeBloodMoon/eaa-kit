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

import type { PageCache } from '../audit/cache.ts'
import type { CollectedPage } from '../audit/collect.ts'
import { type RunCompleteness, runCompleteness } from '../audit/completeness.ts'
import type { ComponentLocation } from '../audit/component.ts'
import { DEFAULT_TAGS } from '../audit/result.ts'
import type { ReviewOptions } from '../audit/review.ts'
import { TOOL_VERSION } from '../version.ts'
import { advise, emitDocument, fail, note, runEngine, warn } from './command.ts'
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
   * Skip the rules the browserless engine cannot decide, rather than running
   * them and throwing the answer away. Trades the element lists for those
   * rules for about a sixth of the run; no effect under `--browser`.
   */
  fast?: boolean
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
  /**
   * Path to a review record: what a person checked, for the criteria no engine
   * can reach. Reported beside what the run measured and never folded into it.
   */
  review?: string
  /**
   * Days after which a recorded review stops counting. Without it every dated
   * entry stands, because how long a manual review remains true is a judgement
   * about a site's rate of change that this tool cannot make.
   */
  reviewMaxAge?: number
  /**
   * Audit every page, reusing nothing. The cache is on by default because the
   * common case is a build where almost nothing moved; this is for the run that
   * has to be able to say it looked at everything itself.
   */
  noCache?: boolean
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
  if (options.fast && options.browser) {
    // Silently ignoring it would leave somebody believing they had traded
    // detail for speed when they had done neither.
    warn('--fast has no effect with --browser: a real browser can decide those rules.')
  }

  const resolved = await resolvePages(dir, options)
  if (!resolved) return { audits: [], exitCode: 2 }
  const { pages, origin, label, cleanup, directory, completeness: collection } = resolved

  // A credential handed to a run that never makes a request is not a credential
  // anybody needed, and silently ignoring it would leave somebody believing a
  // protected site had been audited when a directory of files was.
  if (options.headers !== undefined && directory !== undefined && !options.browser) {
    warn('--header and --basic-auth apply to pages that are fetched; this run read files.')
  }
  // try/finally rather than a call before each return: auto-detection may have
  // started the project's server, and leaving it running would hold the process
  // open after the report is written.
  try {
    // An explicit --base-url still wins; the crawl's own origin is the default
    // so that a fetched page is audited under the URL it was fetched from.
    const baseUrl = options.baseUrl ?? origin

    // Before the engine, deliberately. Every heavy import below it is an
    // `await import`, so a run whose pages are all cache hits returns without
    // ever loading jsdom or starting a worker — which is most of what a short
    // audit costs.
    const { hits, misses, cache } = await splitByCache(pages, baseUrl, options)

    if (misses.length === 0) {
      // Said differently because it is a different thing: nothing was audited,
      // and the run is about to finish without ever starting an engine.
      note(`Nothing changed in ${label}: reusing ${count(hits.length, 'page')} from the cache.`)
    } else {
      note(
        `Auditing ${count(misses.length, 'page')} in ${label}${await describeEngine(misses, options)}` +
          `${hits.length === 0 ? '' : `, reusing ${count(hits.length, 'unchanged page')}`}…`,
      )
    }

    // The engine is not merely unused when everything is a hit — it is never
    // imported. `runEngine` would load the pool, and the pool would start a
    // worker that loads jsdom, to audit nothing.
    const fresh =
      misses.length === 0
        ? []
        : await runEngine(misses, {
            cwd: options.cwd ?? process.cwd(),
            ...(options.headers === undefined ? {} : { headers: options.headers }),
            ...(baseUrl === undefined ? {} : { baseUrl }),
            ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
            ...(options.browser ? { browser: true } : {}),
            // Only for the browserless engine. A browser can see layout and CSS, so
            // there is nothing here it cannot decide, and disabling those rules
            // there would throw away real verdicts rather than wasted work.
            ...(options.fast && !options.browser ? { fast: true } : {}),
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
    if (!fresh) return { audits: [], exitCode: 2 }

    // Recorded before anything downstream touches them: a baseline moves
    // violations into `accepted`, and storing that would freeze one project's
    // decision into a result that describes a page.
    for (const [index, page] of misses.entries()) {
      const audit = fresh[index]
      if (audit) cache?.put(page, audit)
    }
    await cache?.flush()

    // Back into the order the pages were collected in, so a report does not
    // depend on which of them happened to be cached.
    let audits = inCollectedOrder(pages, [...hits, ...fresh])

    const failOn = options.failOn ?? DEFAULT_FAIL_ON

    if (options.baseline) {
      const applied = await acceptBaseline(audits, options)
      if (!applied) return { audits, exitCode: 2 }
      audits = applied
    }

    const completeness = runCompleteness(audits, collection)

    const review = await loadReview(options)
    // A review asked for and not readable is exit 2 for the same reason a
    // missing baseline is: the run did not report what it was told to report.
    if (review === FAILED) return { audits, exitCode: 2 }

    // label, not dir: it is what the run actually audited. dir is undefined
    // under auto-detection, and was the unused ./dist default under --url,
    // which put a directory nobody read into the report.
    await emit(audits, label, failOn, completeness, options, review)

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
 * Which pages already have a result, and which have to be audited.
 *
 * Runs before the engine is imported, which is the point: a build where nothing
 * changed produces no misses, and a run with no misses never loads jsdom. The
 * cache itself is opened here rather than earlier so that a run given
 * `--no-cache` does not read one at all.
 */
async function splitByCache(
  pages: readonly CollectedPage[],
  baseUrl: string | undefined,
  options: AuditCommandOptions,
): Promise<{ hits: PageAudit[]; misses: CollectedPage[]; cache: PageCache | undefined }> {
  if (options.noCache) return { hits: [], misses: [...pages], cache: undefined }

  const { fromEntry, openCache } = await import('../audit/cache.ts')
  const { pageUrl } = await import('../audit/result.ts')
  const axe = (await import('axe-core')).default

  const engine = options.browser ? ('browser' as const) : ('jsdom' as const)
  const cache = await openCache(
    {
      toolVersion: TOOL_VERSION,
      axeVersion: axe.version,
      tags: DEFAULT_TAGS,
      engine,
      fast: options.fast === true && options.browser !== true,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.headers === undefined ? {} : { headers: options.headers }),
    },
    { ...(options.cwd === undefined ? {} : { cwd: options.cwd }) },
  )

  const hits: PageAudit[] = []
  const misses: CollectedPage[] = []
  for (const page of pages) {
    const entry = cache.get(page)
    if (entry === undefined) misses.push(page)
    else hits.push(fromEntry(entry, page, { url: pageUrl(page, baseUrl), engine }))
  }
  return { hits, misses, cache }
}

/**
 * The audits back in the order their pages were collected in.
 *
 * Collection sorts by path so two runs of one build produce the same report,
 * and splitting the pages into hits and misses would otherwise undo that: the
 * same site would report its pages in a different order depending on which of
 * them somebody had edited since yesterday.
 */
function inCollectedOrder(
  pages: readonly CollectedPage[],
  audits: readonly PageAudit[],
): PageAudit[] {
  const byPath = new Map(audits.map((audit) => [audit.relativePath, audit]))
  const ordered: PageAudit[] = []
  for (const page of pages) {
    const audit = byPath.get(page.relativePath)
    if (audit) ordered.push(audit)
  }
  return ordered
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

/** Distinguishes "no review asked for" from "the review could not be read". */
const FAILED = Symbol('review-failed')

/**
 * Read the review record, when one was asked for.
 *
 * Returns undefined when no `--review` was given, which is the ordinary case,
 * and the sentinel when one was given and could not be read.
 */
async function loadReview(
  options: AuditCommandOptions,
): Promise<ReviewOptions | undefined | typeof FAILED> {
  if (options.review === undefined) return undefined

  const { answeredCount, readReview, ReviewError } = await import('../audit/review.ts')
  try {
    const record = await readReview(options.review, options.cwd ?? process.cwd())
    note(`Review record: ${count(answeredCount(record), 'criterion')} answered`)
    return {
      record,
      ...(options.reviewMaxAge === undefined ? {} : { maxAgeDays: options.reviewMaxAge }),
    }
  } catch (cause) {
    if (cause instanceof ReviewError) {
      fail(cause.message)
      return FAILED
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
  const threads = workers > 1 ? ` across ${workers} threads` : ''
  // Said out loud, because it changes what the report can tell you: the rules
  // it skips are still reported as unevaluated, but without the elements.
  return options.fast ? `${threads}, skipping what this engine cannot decide` : threads
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
  review: ReviewOptions | undefined,
): Promise<void> {
  const format = options.format ?? 'console'
  const toFile = typeof options.output === 'string'
  const body = await renderReport(
    audits,
    dir,
    failOn,
    completeness,
    format,
    toFile,
    options,
    review,
  )

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
  review: ReviewOptions | undefined,
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
          ...(review === undefined ? {} : { review }),
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
        }),
      )
    }
    case 'sarif': {
      const { buildSarifReport, serialiseSarifReport } = await import('../audit/report/sarif.ts')
      return serialiseSarifReport(
        buildSarifReport(audits, {
          directory: dir,
          completeness,
          ...(review === undefined ? {} : { review }),
        }),
      )
    }
    case 'html': {
      const { buildHtmlReport } = await import('../audit/report/html.ts')
      const framework = await detectedFramework(options.cwd ?? process.cwd())
      return buildHtmlReport(audits, {
        ...(await sourceLookups(options.cwd ?? process.cwd(), audits)),
        directory: dir,
        failOn,
        completeness,
        ...(review === undefined ? {} : { review }),
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
        ...(review === undefined ? {} : { review }),
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
