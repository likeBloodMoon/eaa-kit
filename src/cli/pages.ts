import path from 'node:path'
import pc from 'picocolors'
import {
  BuildDirectoryError,
  type CollectedPage,
  collectPages,
  emptyDirectoryHint,
} from '../audit/collect.ts'

/**
 * Where the pages a command audits come from.
 *
 * `audit` and `baseline` both need the same thing: a set of pages, from either a
 * build directory or a running site, with the same diagnostics when there are
 * none. They are siblings, so neither should be reaching into the other for it.
 */

/** The crawl-related options both commands accept. */
export interface CrawlCommandOptions {
  /** Audit a running site instead of a directory. */
  url?: string
  /** Crawl a host that is not loopback. Off by default. */
  allowRemote?: boolean
  /** Ignore robots.txt while crawling. */
  ignoreRobots?: boolean
  /** Stop the crawl after this many pages. */
  maxPages?: number
  /** How far from the entry point to follow links. */
  maxDepth?: number
  /** Per-request timeout, shared with the audit runners. */
  timeoutMs?: number
}

export interface ResolvePagesOptions extends CrawlCommandOptions {
  include?: string[]
  exclude?: string[]
  /** Where relative paths are resolved from, for the diagnostics. */
  cwd?: string
  /** Never run the project's build or start its server. */
  noBuild?: boolean
  /**
   * How to name the directory in messages. Defaults to the directory itself.
   * `baseline` resolves the path before collecting but still wants the reader
   * to see what they typed, not an absolute path they never wrote.
   */
  label?: string
}

export interface ResolvedPages {
  pages: CollectedPage[]
  /** Stops anything auto-detection started, once the report is written. */
  cleanup?: () => Promise<void>
  /**
   * Origin the pages were fetched from, when they came off a running site. It
   * becomes the document URL each page is audited under, which is what makes
   * root-absolute asset paths and relative hrefs resolve as they do in a
   * browser. Undefined for pages read off disk.
   */
  origin?: string
  /** What to call the source in progress output: the directory or the URL. */
  label: string
}

/**
 * Collect the pages to audit, reporting to stderr on the way.
 *
 * Returns undefined when there is nothing to audit, having already explained
 * why. Every caller turns that into exit 2 — a run that reached no verdict,
 * which is not the same as a clean one.
 */
export async function resolvePages(
  /**
   * Build directory, already resolved by the caller if it resolves at all, or
   * undefined to work it out from the project.
   */
  directory: string | undefined,
  options: ResolvePagesOptions = {},
): Promise<ResolvedPages | undefined> {
  if (directory === undefined && options.url === undefined) {
    return resolveAutomatically(options)
  }
  if (options.url !== undefined) {
    const crawled = await crawlPages(options.url, options)
    if (!crawled) return undefined
    if (crawled.pages.length === 0) {
      process.stderr.write(
        `${pc.yellow('warning')} No pages could be fetched from ${options.url}\n`,
      )
      return undefined
    }
    return { pages: crawled.pages, origin: crawled.origin, label: options.url }
  }

  const cwd = options.cwd ?? process.cwd()
  const shown = options.label ?? (directory as string)
  let pages: CollectedPage[]
  try {
    pages = await collectPages(directory as string, {
      ...(options.include ? { include: options.include } : {}),
      ...(options.exclude ? { exclude: options.exclude } : {}),
    })
  } catch (cause) {
    if (!(cause instanceof BuildDirectoryError)) throw cause
    // A directory that is not there and one holding no HTML are the same
    // mistake to whoever typed the path, so they get the same advice. This is
    // what somebody sees pointing the tool at ./dist in a Next.js project,
    // which is the commonest way to arrive here at all.
    process.stderr.write(`${pc.red('error')} ${cause.message}\n`)
    process.stderr.write(pc.dim(`${await emptyDirectoryHint(shown, cwd)}\n`))
    return undefined
  }

  if (pages.length === 0) {
    process.stderr.write(`${pc.yellow('warning')} ${await emptyDirectoryHint(shown, cwd)}\n`)
    return undefined
  }

  return { pages, label: shown }
}

/**
 * Fetch the pages of a running site, reporting what happened on the way.
 *
 * Returns undefined when the crawl could not start, which the caller turns into
 * exit 2 — a run that reached no verdict, not a clean one.
 */
async function crawlPages(
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

/**
 * No directory and no URL: work out what this project needs.
 *
 * The point is that `eaa-kit audit` on its own does something useful. Anything
 * this starts is handed back as `cleanup` so the caller can stop it once the
 * report is written.
 */
async function resolveAutomatically(
  options: ResolvePagesOptions,
): Promise<ResolvedPages | undefined> {
  const cwd = options.cwd ?? process.cwd()
  const { autoDetectSource } = await import('../audit/project.ts')

  const detected = await autoDetectSource(cwd, {
    ...(options.noBuild ? { noBuild: true } : {}),
    onStep: (message) => process.stderr.write(pc.dim(`${message}\n`)),
  })

  if (detected?.directory !== undefined) {
    const resolved = await resolvePages(detected.directory, {
      ...options,
      label: path.relative(cwd, detected.directory) || '.',
    })
    return resolved
  }

  if (detected?.url !== undefined) {
    const resolved = await resolvePages(undefined, { ...options, url: detected.url })
    if (resolved === undefined) {
      await detected.cleanup?.()
      return undefined
    }
    return { ...resolved, ...(detected.cleanup ? { cleanup: detected.cleanup } : {}) }
  }

  await detected?.cleanup?.()
  // Nothing worked. The directory hint knows this project better than anything
  // here does, so it explains rather than a second message competing with it.
  process.stderr.write(`${pc.yellow('warning')} ${await emptyDirectoryHint('./dist', cwd)}\n`)
  return undefined
}
