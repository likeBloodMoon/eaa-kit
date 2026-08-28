import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pc from 'picocolors'
import {
  BuildDirectoryError,
  type CollectedPage,
  collectPages,
  emptyDirectoryHint,
} from '../audit/collect.ts'
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

export const OUTPUT_FORMATS = ['console', 'json', 'sarif', 'html'] as const

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value)
}

/** The crawl-related options `audit` and `baseline` both accept. */
export interface CrawlCommandOptions {
  allowRemote?: boolean
  ignoreRobots?: boolean
  maxPages?: number
  maxDepth?: number
  timeoutMs?: number
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
  /**
   * Audit a running site instead of a directory. Mutually exclusive with dir.
   * The pages are fetched rather than read, which is the only way to reach a
   * site that renders on a server and never writes HTML to disk.
   */
  url?: string
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
  dir: string,
  options: AuditCommandOptions = {},
): Promise<AuditCommandResult> {
  let pages: Awaited<ReturnType<typeof collectPages>>
  // The origin, when the pages came off a running site. It becomes the document
  // URL every page is audited under, which is what makes root-absolute asset
  // paths and relative hrefs resolve the way they do in a browser.
  let crawledOrigin: string | undefined
  let source = dir

  if (options.url !== undefined) {
    const crawled = await crawlPages(options.url, options)
    if (!crawled) return { audits: [], exitCode: 2 }
    pages = crawled.pages
    crawledOrigin = crawled.origin
    source = options.url
  } else {
    try {
      pages = await collectPages(dir, {
        ...(options.include ? { include: options.include } : {}),
        ...(options.exclude ? { exclude: options.exclude } : {}),
      })
    } catch (cause) {
      if (cause instanceof BuildDirectoryError) {
        // A directory that is not there and one that holds no HTML are the same
        // mistake to whoever typed it, so they get the same advice. This is the
        // message somebody sees when they point the tool at ./dist in a Next.js
        // project, which is the single commonest way to arrive here.
        process.stderr.write(`${pc.red('error')} ${cause.message}\n`)
        process.stderr.write(
          pc.dim(`${await emptyDirectoryHint(dir, options.cwd ?? process.cwd())}\n`),
        )
        return { audits: [], exitCode: 2 }
      }
      throw cause
    }
  }

  if (pages.length === 0) {
    if (options.url !== undefined) {
      process.stderr.write(
        `${pc.yellow('warning')} No pages could be fetched from ${options.url}\n`,
      )
      return { audits: [], exitCode: 2 }
    }
    process.stderr.write(
      `${pc.yellow('warning')} ${await emptyDirectoryHint(dir, options.cwd ?? process.cwd())}\n`,
    )
    return { audits: [], exitCode: 2 }
  }

  const engineNote = await describeEngine(pages, options)
  process.stderr.write(
    pc.dim(
      `Auditing ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} in ${source}${engineNote}…\n`,
    ),
  )

  // An explicit --base-url still wins; the crawl's own origin is the default, so
  // a fetched page is audited under the URL it was actually fetched from.
  const effectiveBaseUrl: string | undefined = options.baseUrl ?? crawledOrigin

  const runnerOptions = {
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

  await emit(audits, dir, failOn, options)

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
      return buildHtmlReport(audits, {
        directory: dir,
        failOn,
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      })
    }
    case 'console':
      return `${formatConsoleReport(audits, { dir, failOn, ...(toFile ? { color: false } : {}) })}\n`
  }
}

/**
 * Fetch the pages of a running site, reporting what happened on the way.
 *
 * Returns undefined when the crawl could not start, which the caller turns into
 * exit 2 — a run that reached no verdict, not a clean one.
 */
export async function crawlPages(
  url: string,
  options: CrawlCommandOptions,
): Promise<{ pages: CollectedPage[]; origin: string } | undefined> {
  const { crawlSite, CrawlError, parseEntryUrl } = await import('../audit/crawl.ts')

  let entry: URL
  try {
    entry = parseEntryUrl(url, options.allowRemote ?? false)
  } catch (cause) {
    if (cause instanceof CrawlError) {
      process.stderr.write(`${pc.red('error')} ${cause.message}\n`)
      return undefined
    }
    throw cause
  }

  process.stderr.write(pc.dim(`Crawling ${entry.origin}…\n`))

  const result = await crawlSite(entry, {
    ...(options.allowRemote ? { allowRemote: true } : {}),
    ...(options.ignoreRobots ? { ignoreRobots: true } : {}),
    ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })

  if (result.pages.length === 0 && result.failures.length > 0) {
    // Nothing came back at all. Almost always a server that is not running,
    // and saying so beats reporting a site with no pages.
    process.stderr.write(
      `${pc.red('error')} Could not fetch ${entry.href} (${result.failures[0]?.reason})\n`,
    )
    process.stderr.write(pc.dim('  Is the site running at that address?\n'))
    return undefined
  }

  process.stderr.write(
    pc.dim(
      `Found ${result.pages.length} ${result.pages.length === 1 ? 'page' : 'pages'} from ${
        result.discovery === 'sitemap' ? 'sitemap.xml and links' : 'links'
      }\n`,
    ),
  )

  // Pages that could not be fetched are named rather than counted away: a
  // crawl that quietly skipped half the site would report the other half as if
  // it were the whole thing.
  if (result.failures.length > 0) {
    process.stderr.write(
      `${pc.yellow('warning')} ${result.failures.length} ${
        result.failures.length === 1 ? 'URL was' : 'URLs were'
      } not fetched, and so not audited:\n`,
    )
    for (const failure of result.failures.slice(0, 10)) {
      process.stderr.write(pc.dim(`  ${failure.url} — ${failure.reason}\n`))
    }
    if (result.failures.length > 10) {
      process.stderr.write(pc.dim(`  …and ${result.failures.length - 10} more\n`))
    }
  }

  if (result.truncated) {
    process.stderr.write(
      `${pc.yellow('warning')} Stopped at ${result.pages.length} ${
        result.pages.length === 1 ? 'page' : 'pages'
      }; the site has more. Raise --max-pages to go further.\n`,
    )
  }

  return { pages: result.pages, origin: result.origin }
}
