import path from 'node:path'
import {
  BuildDirectoryError,
  type CollectedPage,
  collectPages,
  emptyDirectoryHint,
} from '../audit/collect.ts'
import type { Collection, Unmeasured } from '../audit/completeness.ts'
import { count } from '../text.ts'
import { fail, note, warn } from './command.ts'

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
  /** Where the site lists its pages, when that is not /sitemap.xml. */
  sitemap?: string
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
  /**
   * What this stage found and what it could not reach, for the report to say.
   * Warning about it on stderr is not enough: the person who reads the report
   * is usually not the person who watched it run.
   */
  completeness: Collection
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
      warn(`No pages could be fetched from ${options.url}`)
      return undefined
    }
    return {
      pages: crawled.pages,
      origin: crawled.origin,
      label: options.url,
      completeness: crawled.completeness,
    }
  }

  const cwd = options.cwd ?? process.cwd()
  const shown = options.label ?? (directory as string)
  // Files that matched the globs and could not be opened. One of these used to
  // reject the whole collection; it is now the build minus that page, said out
  // loud rather than silently.
  const unreachable: Unmeasured[] = []
  let pages: CollectedPage[]
  try {
    pages = await collectPages(directory as string, {
      ...(options.include ? { include: options.include } : {}),
      ...(options.exclude ? { exclude: options.exclude } : {}),
      onUnreadable: (relativePath, reason) => unreachable.push({ location: relativePath, reason }),
    })
  } catch (cause) {
    if (!(cause instanceof BuildDirectoryError)) throw cause
    // A directory that is not there and one holding no HTML are the same
    // mistake to whoever typed the path, so they get the same advice. This is
    // what somebody sees pointing the tool at ./dist in a Next.js project,
    // which is the commonest way to arrive here at all.
    fail(cause.message)
    note(await emptyDirectoryHint(shown, cwd))
    return undefined
  }

  if (pages.length === 0) {
    warn(await emptyDirectoryHint(shown, cwd))
    return undefined
  }

  if (unreachable.length > 0) {
    const verb = unreachable.length === 1 ? 'file was' : 'files were'
    warn(`${unreachable.length} ${verb} not readable, and so not audited:`)
    for (const file of unreachable.slice(0, 10)) {
      note(`  ${file.location} — ${file.reason}`)
    }
    if (unreachable.length > 10) note(`  …and ${unreachable.length - 10} more`)
  }

  return {
    pages,
    label: shown,
    completeness: {
      discovery: 'directory',
      collected: pages.length,
      unreachable,
      // A directory audit reads every file it globbed; there is no limit for it
      // to stop at.
      truncated: false,
    },
  }
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
): Promise<{ pages: CollectedPage[]; origin: string; completeness: Collection } | undefined> {
  const { crawlSite, CrawlError, parseEntryUrl } = await import('../audit/crawl.ts')

  let entry: URL
  try {
    entry = parseEntryUrl(url, options.allowRemote ?? false)
  } catch (cause) {
    if (cause instanceof CrawlError) {
      fail(cause.message)
      return undefined
    }
    throw cause
  }

  note(`Crawling ${entry.origin}…`)

  const result = await crawlSite(entry, {
    ...(options.allowRemote ? { allowRemote: true } : {}),
    ...(options.ignoreRobots ? { ignoreRobots: true } : {}),
    ...(options.sitemap === undefined ? {} : { sitemap: options.sitemap }),
    ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })

  if (result.pages.length === 0 && result.failures.length > 0) {
    // Nothing came back at all. Almost always a server that is not running,
    // and saying so beats reporting a site with no pages.
    fail(`Could not fetch ${entry.href} (${result.failures[0]?.reason})`)
    note('  Is the site running at that address?')
    return undefined
  }

  const found = result.discovery === 'sitemap' ? 'sitemap.xml and links' : 'links'
  note(`Found ${count(result.pages.length, 'page')} from ${found}`)

  // Pages that could not be fetched are named rather than counted away: a
  // crawl that quietly skipped half the site would report the other half as if
  // it were the whole thing.
  if (result.failures.length > 0) {
    const verb = result.failures.length === 1 ? 'URL was' : 'URLs were'
    warn(`${result.failures.length} ${verb} not fetched, and so not audited:`)
    for (const failure of result.failures.slice(0, 10)) {
      note(`  ${failure.url} — ${failure.reason}`)
    }
    if (result.failures.length > 10) {
      note(`  …and ${result.failures.length - 10} more`)
    }
  }

  if (result.truncated) {
    warn(
      `Stopped at ${count(result.pages.length, 'page')}; the site has more. Raise --max-pages to go further.`,
    )
  }

  return {
    pages: result.pages,
    origin: result.origin,
    completeness: {
      discovery: result.discovery,
      collected: result.pages.length,
      unreachable: result.failures.map((failure) => ({
        location: failure.url,
        reason: failure.reason,
      })),
      truncated: result.truncated,
    },
  }
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
    onStep: note,
  })

  if (detected?.directory !== undefined) {
    return resolvePages(detected.directory, {
      ...options,
      label: path.relative(cwd, detected.directory) || '.',
    })
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
  warn(await emptyDirectoryHint('./dist', cwd))
  return undefined
}
