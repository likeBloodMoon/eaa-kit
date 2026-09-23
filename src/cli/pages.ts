import path from 'node:path'
import {
  BuildDirectoryError,
  type CollectedPage,
  collectPages,
  emptyDirectoryHint,
  holdsHtml,
} from '../audit/collect.ts'
import type { Collection, EntryRedirect, Unmeasured } from '../audit/completeness.ts'
import type { RedirectMode } from '../config/define.ts'
import { count } from '../text.ts'
import { fail, failWith, nextStep, note, warn } from './command.ts'

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
  /**
   * Extra request headers, for a site behind a login or preview protection.
   * Sent by the crawl and by the browser runner, and never written down.
   */
  headers?: Record<string, string>
  /** What to do when the entry URL redirects to another site. Defaults to `ask`. */
  redirects?: RedirectMode
  /**
   * Asks whether to follow a redirect to another site. Defaults to a prompt on
   * the terminal when there is one, and to nothing when there is not, which
   * `ask` then treats as a no.
   */
  confirm?: (question: string) => Promise<boolean>
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch
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
  /**
   * Directory the pages were read off disk from, absolute or as the caller
   * gave it. Undefined for a crawl, whose pages have a server of their own.
   *
   * Carried rather than left to the caller's own argument, because under
   * auto-detection there is no argument: the caller passed undefined and this
   * stage worked the directory out. A caller that reached for its own `dir`
   * got undefined there and treated a build on disk as though it had been
   * crawled — which is exactly what the browser runner uses to decide whether
   * to serve the pages over loopback or navigate to them directly.
   */
  directory?: string
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
    failWith(cause)
    note(await emptyDirectoryHint(shown, cwd))
    return undefined
  }

  if (pages.length === 0) {
    // A build directory full of HTML that the globs excluded is not the same
    // mistake as one with no HTML in it, and the framework advice for the
    // second is actively wrong for the first: it names another directory to
    // audit when the directory was never the problem. So the filters are
    // checked before that advice is offered.
    const filtered =
      (options.include !== undefined || options.exclude !== undefined) &&
      (await holdsHtml(directory as string))
    if (filtered) {
      warn(`No page in ${shown} matched the filters, so nothing was audited.`)
      if (options.include !== undefined) note(`  --include ${options.include.join(' ')}`)
      if (options.exclude !== undefined) note(`  --exclude ${options.exclude.join(' ')}`)
      note('  Patterns are relative to the audited directory, with POSIX separators.')
      return undefined
    }
    warn(await emptyDirectoryHint(shown, cwd))
    return undefined
  }

  warnUnmeasured(unreachable, 'file', 'readable')

  return {
    pages,
    directory: directory as string,
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
 * Name what was missed, up to ten of them, and count the rest.
 *
 * Both collectors need this and neither may skip it: a file that could not be
 * read and a URL that could not be fetched are pages with no verdict, and a run
 * that mentioned neither would report the rest of the site as though it were
 * the site. Ten because the point is to make the problem recognisable, and two
 * hundred failures usually have the one reason the first few show — the count
 * that follows is what says the list was cut.
 */
function warnUnmeasured(missed: readonly Unmeasured[], noun: string, reached: string): void {
  if (missed.length === 0) return

  warn(
    `${count(missed.length, noun)} ${missed.length === 1 ? 'was' : 'were'} not ${reached}, and so not audited:`,
  )
  for (const item of missed.slice(0, 10)) note(`  ${item.location} — ${item.reason}`)
  if (missed.length > 10) note(`  …and ${missed.length - 10} more`)
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
  const { collapsedOnto, crawlSite, CrawlError, parseEntryUrl } = await import('../audit/crawl.ts')

  let entry: URL
  try {
    entry = parseEntryUrl(url, options.allowRemote ?? false)
  } catch (cause) {
    if (cause instanceof CrawlError) {
      failWith(cause)
      return undefined
    }
    throw cause
  }

  note(`Crawling ${entry.origin}…`)

  const followed = await followEntry(entry, options)
  if (followed === undefined) return undefined
  entry = followed.entry

  const result = await crawlSite(entry, {
    ...(options.allowRemote ? { allowRemote: true } : {}),
    ...(options.ignoreRobots ? { ignoreRobots: true } : {}),
    ...(options.sitemap === undefined ? {} : { sitemap: options.sitemap }),
    ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
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
  const failed = result.failures.map((failure) => ({
    location: failure.url,
    reason: failure.reason,
  }))
  warnUnmeasured(failed, 'URL', 'fetched')

  if (result.truncated) {
    warn(
      `Stopped at ${count(result.pages.length, 'page')}; the site has more. Raise --max-pages to go further.`,
    )
  }

  // A sign-in page standing in front of the site is the one failure that looks
  // like a success: every request answers 200, the run audits the login form
  // and reports it as the site. Said here, and carried into the report below,
  // because somebody reading an HTML report was never at this terminal.
  const collapsed = collapsedOnto(result)
  // A password field on the page everything landed on turns "looks like" into
  // "is": that is a sign-in form, and the requested pages are behind it.
  const { hasPasswordField } = await import('../audit/entry.ts')
  const landedOn = collapsed[0]?.landedOn ?? ''
  const signInForm =
    collapsed.length > 0 &&
    result.pages.some((page) => page.absolutePath === landedOn && hasPasswordField(page.html))
  if (collapsed.length > 0) {
    if (signInForm) {
      warn(
        `Every page requested answered at ${landedOn}, which has a password field on it: a sign-in page stands in front of the site.`,
      )
    } else {
      warn(`Every page requested answered at ${landedOn}, which is not where it was asked.`)
      note('  A sign-in page in front of the site looks like this, and so does a one-page site.')
    }
    nextStep({
      command: `eaa-kit audit --url ${entry.href} --basic-auth user:password`,
      why: 'or --header "Cookie: …" with a signed-in session; neither is written into a report',
    })
  }

  return {
    pages: result.pages,
    origin: result.origin,
    completeness: {
      discovery: result.discovery,
      collected: result.pages.length,
      unreachable: [
        ...failed,
        // Never reached, whatever the status code said: the run has a verdict
        // about the page it was sent to, and none about the page it asked for.
        ...collapsed.map((redirect) => ({
          location: redirect.requested,
          reason: signInForm
            ? `answered at ${redirect.landedOn} instead, a sign-in page, so this page was not audited`
            : `answered at ${redirect.landedOn} instead, so this page was not audited`,
        })),
      ],
      truncated: result.truncated,
      ...(followed.redirect === undefined ? {} : { entryRedirect: followed.redirect }),
    },
  }
}

/**
 * Where the crawl should start, once the entry's redirects are known.
 *
 * Returns undefined when the run must stop, having said why and what to type:
 * a sign-in wall, or a redirect to another site nobody agreed to follow. Those
 * are the two ways a run can audit something other than what it was sent to,
 * and each one ends here rather than in a report about the wrong pages.
 */
async function followEntry(
  entry: URL,
  options: CrawlCommandOptions,
): Promise<{ entry: URL; redirect?: EntryRedirect } | undefined> {
  const { describeSignIn, isSameSite, probeEntry } = await import('../audit/entry.ts')
  const { CrawlError, DEFAULT_REQUEST_TIMEOUT_MS, MAX_BODY_BYTES, parseEntryUrl } = await import(
    '../audit/crawl.ts'
  )

  const probe = await probeEntry(entry, {
    timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxBodyBytes: MAX_BODY_BYTES,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  })

  // Not reachable at all is the crawl's to report, as it always has been.
  if (probe.error !== undefined && probe.hops.length === 0) return { entry }
  if (probe.error !== undefined) {
    fail(`${entry.href} did not settle on a page: ${probe.error}`)
    return undefined
  }

  if (probe.signIn !== undefined) {
    const at = probe.final.href
    fail(`${entry.href} is behind a sign-in wall: ${describeSignIn(probe.signIn, at)}.`)
    note(
      options.headers !== undefined
        ? '  The credentials that were sent were not accepted, so nothing was audited.'
        : probe.signIn === 'http-401' || probe.signIn === 'http-403'
          ? '  Nothing was audited: there is no page to audit until the site lets the run in.'
          : '  eaa-kit will not audit a sign-in form as though it were the site, so nothing was audited.',
    )
    nextStep(
      probe.signIn === 'http-401'
        ? {
            command: `eaa-kit audit --url ${entry.href} --basic-auth user:password`,
            why: 'send the credentials it asks for; they are never written into a report',
          }
        : {
            command: `eaa-kit audit --url ${entry.href} --header "Cookie: <session>"`,
            why: 'send a signed-in session, copied from your browser; never written into a report',
          },
    )
    return undefined
  }

  const destination = probe.final
  if (destination.origin === entry.origin) return { entry }

  const statuses = probe.hops.slice(0, -1).map((hop) => hop.status)
  const chain = `${statuses.join(' → ')}`
  const sameSite = isSameSite(entry, destination)
  const mode = options.redirects ?? 'ask'

  let because: EntryRedirect['followedBecause'] | undefined
  if (mode !== 'stop' && sameSite) because = 'same-site'
  else if (mode === 'follow') because = 'flag'
  else if (mode === 'ask') {
    const confirm = options.confirm ?? terminalConfirm()
    if (
      confirm !== undefined &&
      (await confirm(
        `${entry.href} redirects to ${destination.href} (${chain}). Audit ${destination.href} instead?`,
      ))
    ) {
      because = 'prompt'
    }
  }

  if (because === undefined) {
    fail(
      `${entry.href} redirects to ${destination.href} (${chain}), ` +
        `${sameSite ? 'the same site at another address' : 'which is a different site'}, so nothing was audited.`,
    )
    note(
      mode === 'stop'
        ? '  --redirects stop was asked for, so the redirect was not followed.'
        : '  eaa-kit only follows a redirect to another site when you agree to it: otherwise the\n' +
            '  report would describe a site you did not name.',
    )
    const remote = options.allowRemote ? ' --allow-remote' : ''
    nextStep({
      command: `eaa-kit audit --url ${destination.href}${remote}`,
      why: 'audit the address it leads to',
    })
    nextStep({
      command: `eaa-kit audit --url ${entry.href}${remote} --redirects follow`,
      why: 'or follow it on every run, and have each report say so',
    })
    return undefined
  }

  // The destination has to pass the same gate the entry did: a local entry
  // redirected to the internet is a remote crawl nobody allowed.
  let target: URL
  try {
    target = parseEntryUrl(destination.href, options.allowRemote ?? false)
  } catch (cause) {
    if (cause instanceof CrawlError) {
      fail(`${entry.href} redirects to ${destination.href}.`)
      failWith(cause)
      return undefined
    }
    throw cause
  }

  warn(
    `${entry.href} redirects to ${target.href} (${chain}). Auditing ${target.href}; every report says so.`,
  )
  return {
    entry: target,
    redirect: {
      requested: entry.href,
      auditedFrom: target.href,
      statuses,
      followedBecause: because,
    },
  }
}

/** A yes/no question on the terminal, or nothing when there is no terminal to ask at. */
function terminalConfirm(): ((question: string) => Promise<boolean>) | undefined {
  if (process.stdin.isTTY !== true || process.stderr.isTTY !== true) return undefined
  return async (question) => {
    const { createInterface } = await import('node:readline/promises')
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    try {
      const answer = await rl.question(`${question} (y/N) `)
      return /^y(es)?$/i.test(answer.trim())
    } finally {
      rl.close()
    }
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
