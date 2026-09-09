import { type CollectedPage, stripBom } from './collect.ts'

/**
 * Collect pages from a running site instead of a build directory.
 *
 * The directory collector covers everything that ships as HTML on disk, which
 * is every static builder — and not Next.js, Nuxt, SvelteKit or Remix running
 * with a server, where the HTML only exists once something has rendered it.
 * Telling those projects to produce a static export first rules out every site
 * that cannot be exported, which is most of the ones people are paid to build.
 *
 * So this fetches instead. What comes back is the same `CollectedPage` shape the
 * directory collector produces, so the audit, the reports, baselines and
 * `--fail-on` all work on it unchanged: only the source of the markup differs.
 *
 * What it deliberately does not do is render. The browserless engine sees what
 * the server sent, which for a server-rendered page is the real markup and for
 * a client-rendered one is a shell — the same limit the directory path has, and
 * `--browser` is the same answer.
 */

/** Pages fetched before the crawl stops, unless overridden. */
export const DEFAULT_MAX_PAGES = 200

/** Links deep from the entry point, unless overridden. */
export const DEFAULT_MAX_DEPTH = 3

/** Per-request timeout. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

/** Requests in flight at once. Politeness, not throughput. */
const REQUEST_CONCURRENCY = 4

/**
 * Largest response body this will read, in bytes.
 *
 * A crawl reads whatever the server sends, and nothing obliges a server to send
 * something reasonable — a misconfigured export endpoint, a log streamed as
 * text/html, or a host that simply does not stop. `response.text()` buffers all
 * of it before anyone can object, so the ceiling has to be applied while the
 * body is still arriving.
 *
 * Matches the on-disk page limit: the two paths audit the same kind of
 * document, and a page that would be declined off disk should not be accepted
 * because it arrived over HTTP instead.
 */
const MAX_BODY_BYTES = 32 * 1024 * 1024

export class CrawlError extends Error {
  override readonly name = 'CrawlError'
}

export interface CrawlOptions {
  /** Stop after this many pages. Defaults to DEFAULT_MAX_PAGES. */
  maxPages?: number
  /** How far from the entry point to follow links. Defaults to DEFAULT_MAX_DEPTH. */
  maxDepth?: number
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
  /**
   * Crawl a host that is not loopback. Off by default: a tool that fails builds
   * should not be one flag away from crawling production, or somebody else's
   * site, from CI.
   */
  allowRemote?: boolean
  /** Ignore robots.txt. Only honoured together with allowRemote. */
  ignoreRobots?: boolean
  /**
   * Where the site lists its own pages, when that is not `/sitemap.xml`.
   *
   * A CMS rarely puts it there: WordPress with Yoast serves `/sitemap_index.xml`,
   * TYPO3 and Craft put it behind a route of their own. Link following alone
   * then finds only what the navigation happens to link to, which on a site with
   * a thousand articles is the front page and a menu.
   *
   * Relative to the entry URL, or absolute on the same origin.
   */
  sitemap?: string
  /**
   * Largest response body to read, in bytes. Defaults to MAX_BODY_BYTES. A
   * response over it is recorded as a failure rather than buffered.
   */
  maxBodyBytes?: number
  /**
   * Extra request headers, for a site behind a login or a preview protection.
   * Sent on every request the crawl makes — pages, robots.txt and the sitemap —
   * because a site that needs credentials needs them for all three.
   *
   * Credentials. Never recorded in a report, and never logged.
   */
  headers?: Record<string, string>
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Called as pages arrive, for progress reporting. */
  onProgress?: (fetched: number, queued: number) => void
}

export interface CrawlResult {
  pages: CollectedPage[]
  /** Origin every page was fetched from, without a trailing slash. */
  origin: string
  /** URLs that could not be fetched, with the reason. */
  failures: Array<{ url: string; reason: string }>
  /**
   * URLs that answered somewhere other than where they were asked.
   *
   * Recorded because a redirect is the one way a run can audit something other
   * than what it was told to audit and still look like it succeeded. Most are
   * ordinary — a trailing slash, a locale prefix — and the caller decides what
   * to make of them; `collapsedOnto` names the case that is not ordinary.
   */
  redirects: Array<{ requested: string; landedOn: string }>
  /** True when the crawl stopped at maxPages rather than running out of links. */
  truncated: boolean
  /** How the pages were found. */
  discovery: 'sitemap' | 'links'
}

/** Hosts that are this machine. Anything else needs allowRemote. */
function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  )
}

export function parseEntryUrl(raw: string, allowRemote = false): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new CrawlError(`${raw} is not a URL. Include the scheme, e.g. http://localhost:3000`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CrawlError(`${raw} is not an http or https URL`)
  }
  if (!allowRemote && !isLoopback(url.hostname)) {
    throw new CrawlError(
      `${url.host} is not a local address, and eaa-kit does not crawl remote hosts by default.\n` +
        '  Auditing a site you do not control sends it traffic and reads pages you may not\n' +
        '  have meant to. Pass --allow-remote if this is your site and you meant to.',
    )
  }
  return url
}

/**
 * Page path used as the page's identity, relative to the origin.
 *
 * This is what appears in reports and what a baseline matches on, so it has to
 * be stable across runs and independent of how the link was written. The query
 * string is dropped — two URLs differing only by a tracking parameter are the
 * same page — and the fragment with it.
 */
export function pageIdentity(url: URL): string {
  const path = url.pathname.replace(/^\/+/, '')
  return path === '' ? '/' : path
}

/** Same site: same protocol, host and port. */
function sameOrigin(a: URL, b: URL): boolean {
  return a.origin === b.origin
}

/**
 * Links worth following. Anything that is not a page — an asset, a download, a
 * mailto: — is left alone, and so is anything off-origin.
 */
const NON_PAGE =
  /\.(?:css|js|mjs|json|xml|txt|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|pdf|zip|gz|mp4|webm|mp3|wav)$/i

export function linksFrom(html: string, from: URL): URL[] {
  const found: URL[] = []
  const seen = new Set<string>()

  // Deliberately a regex rather than a parse: this runs before the audit, on
  // markup that has not been vetted, and standing up a DOM per page to read
  // hrefs would double the cost of a crawl for something a scan does as well.
  for (const match of html.matchAll(/<a\b[^>]*?\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const raw = (match[2] ?? match[3] ?? match[4] ?? '').trim()
    if (raw === '' || raw.startsWith('#')) continue
    if (/^(?:mailto|tel|javascript|data):/i.test(raw)) continue

    let target: URL
    try {
      target = new URL(raw, from)
    } catch {
      continue
    }
    target.hash = ''
    if (!sameOrigin(target, from)) continue
    if (NON_PAGE.test(target.pathname)) continue
    if (seen.has(target.href)) continue
    seen.add(target.href)
    found.push(target)
  }
  return found
}

/** Page URLs listed in a sitemap, including one level of sitemap index. */
export function urlsFromSitemap(xml: string, origin: URL): URL[] {
  const urls: URL[] = []
  for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const raw = match[1]
    if (!raw) continue
    try {
      const url = new URL(raw)
      url.hash = ''
      if (sameOrigin(url, origin)) urls.push(url)
    } catch {
      // a loc that is not a URL is not a page
    }
  }
  return urls
}

interface Fetched {
  url: URL
  html: string
}

/** One request, with a timeout, returning HTML or a reason it is not a page. */
async function fetchPage(
  url: URL,
  impl: typeof fetch,
  timeoutMs: number,
  /** Origin the crawl is confined to. A redirect that leaves it is refused. */
  origin: string,
  maxBodyBytes: number,
  headers: Record<string, string> | undefined,
): Promise<{ ok: true; value: Fetched } | { ok: false; reason: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await impl(url.href, {
      signal: controller.signal,
      redirect: 'follow',
      // Caller's headers last: somebody who sets a user-agent means it.
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'eaa-kit',
        ...headers,
      },
    })
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }

    // The response URL, not the requested one: a redirect means the page that
    // was audited lives somewhere else, and reporting the old path would point
    // whoever has to fix it at a URL that does not serve this markup.
    const finalUrl = new URL(response.url || url.href)
    finalUrl.hash = ''

    // Checked before anything else about the response, because a redirect is
    // the one way out of the origin that neither the link filter nor the
    // sitemap filter sees. Without it a loopback crawl redirected anywhere — an
    // internal host, the public internet — follows it and audits what it finds,
    // which is exactly what --allow-remote exists to gate. It is also the more
    // useful thing to report than whatever the off-origin response turned out
    // to contain.
    if (finalUrl.origin !== origin) {
      return { ok: false, reason: `redirected off ${origin} to ${finalUrl.origin}` }
    }

    // A crawl follows links, and a link can point at anything. Auditing a PDF
    // or a JSON endpoint as if it were markup produces findings about a
    // document that was never a page.
    const type = response.headers.get('content-type') ?? ''
    if (!/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(type)) {
      return { ok: false, reason: `not HTML (${type.split(';')[0] || 'no content-type'})` }
    }

    const body = await readCapped(response, maxBodyBytes)
    if (body === undefined) {
      return { ok: false, reason: `larger than the ${maxBodyBytes} byte limit for one page` }
    }
    return { ok: true, value: { url: finalUrl, html: body } }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return {
      ok: false,
      reason: controller.signal.aborted ? `timed out after ${timeoutMs}ms` : message,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A response body, up to a limit, or undefined when it runs past it.
 *
 * Streamed rather than buffered, because `response.text()` has already read
 * everything by the time it could be checked, and a content-length header is
 * both optional and unverified — a chunked response carries no length at all,
 * and one that carries a length is not obliged to tell the truth. Counting the
 * bytes as they arrive is the only check that holds either way, and the body is
 * cancelled the moment it goes over so nothing keeps arriving.
 */
async function readCapped(response: Response, limit: number): Promise<string | undefined> {
  const body = response.body
  // No stream to meter — an implementation that does not expose one, which the
  // injectable fetch in the tests is. Fall back to the length after the fact.
  if (!body) {
    const text = await response.text()
    return text.length > limit ? undefined : text
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.byteLength
      if (total > limit) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  return new TextDecoder().decode(concat(chunks, total))
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const joined = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    joined.set(chunk, at)
    at += chunk.byteLength
  }
  return joined
}

/** Paths robots.txt disallows for us. Only the wildcard group is read. */
export function disallowedPaths(robots: string): string[] {
  const lines = robots.split(/\r?\n/).map((line) => line.replace(/#.*$/, '').trim())
  const paths: string[] = []
  let applies = false
  for (const line of lines) {
    const agent = /^user-agent\s*:\s*(.+)$/i.exec(line)
    if (agent) {
      applies = (agent[1] ?? '').trim() === '*'
      continue
    }
    const rule = /^disallow\s*:\s*(.*)$/i.exec(line)
    if (rule && applies) {
      const value = (rule[1] ?? '').trim()
      if (value !== '') paths.push(value)
    }
  }
  return paths
}

/**
 * One of the two files a site publishes about itself, or undefined.
 *
 * Read directly rather than through fetchPage, which correctly refuses anything
 * that is not a page. A site that does not publish one is the ordinary case,
 * not a failure, so it comes back empty either way.
 */
async function fetchSiteFile(
  entry: URL,
  impl: typeof fetch,
  name: string,
  timeoutMs: number,
  maxBodyBytes: number,
  headers: Record<string, string> | undefined,
): Promise<string | undefined> {
  // These two requests are made before any page is fetched, and they used to be
  // the only ones in the crawler with no timeout on them. A server that accepts
  // the connection and then never answers — a hung backend, a stalled proxy,
  // a firewall that blackholes rather than refuses — left the crawl waiting on
  // robots.txt forever, before it had reported a single page.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await impl(new URL(name, entry).href, {
      redirect: 'follow',
      signal: controller.signal,
      ...(headers === undefined ? {} : { headers }),
    })
    if (!response.ok) return undefined

    // The same check fetchPage makes, for the same reason: a redirect is the
    // one way out of the origin that nothing else here sees. A sitemap fetched
    // from somewhere else is not this site's list of its own pages, and
    // seeding the crawl from it would be taking a stranger's word for what to
    // audit.
    const finalUrl = new URL(response.url || new URL(name, entry).href)
    if (finalUrl.origin !== entry.origin) return undefined

    // A sitemap index for a large site is legitimately big, and nothing caps
    // what a server may send. Capped like any other body.
    return await readCapped(response, maxBodyBytes)
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch a site's pages, starting at `entry`.
 *
 * Pages come back sorted by identity, so two crawls of the same site produce
 * the same report even though the requests finish in whatever order the server
 * answers them — the same guarantee the directory collector gives.
 */
export async function crawlSite(entry: URL, options: CrawlOptions = {}): Promise<CrawlResult> {
  const impl = options.fetchImpl ?? fetch
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES
  const failures: CrawlResult['failures'] = []

  // Paths the site's own robots.txt puts off limits.
  const robots = options.ignoreRobots
    ? undefined
    : await fetchSiteFile(entry, impl, '/robots.txt', timeoutMs, maxBodyBytes, options.headers)
  const blocked = robots === undefined ? [] : disallowedPaths(robots)

  const allowed = (url: URL): boolean => !blocked.some((path) => url.pathname.startsWith(path))

  // Seeded from the sitemap when there is one: it is the site's own list of its
  // pages, so it finds what nothing links to and costs one request.
  let discovery: CrawlResult['discovery'] = 'links'
  const queue: Array<{ url: URL; depth: number }> = []
  const queued = new Set<string>()

  const enqueue = (url: URL, depth: number): void => {
    if (queued.has(url.href) || !allowed(url)) return
    queued.add(url.href)
    queue.push({ url, depth })
  }

  // Worth one request: a sitemap finds pages nothing links to, which link
  // following alone never reaches. A named one is asked for and nothing else is
  // tried, so a wrong path is a visible mistake rather than a silent fallback
  // to a crawl that quietly covers less.
  const sitemap = await fetchSiteFile(
    entry,
    impl,
    options.sitemap ?? '/sitemap.xml',
    timeoutMs,
    maxBodyBytes,
    options.headers,
  )
  const listed = sitemap === undefined ? [] : urlsFromSitemap(sitemap, entry)
  if (listed.length > 0) {
    discovery = 'sitemap'
    for (const url of listed) enqueue(url, 0)
  }
  enqueue(entry, 0)

  const pages: CollectedPage[] = []
  const redirects: CrawlResult['redirects'] = []

  while (queue.length > 0 && pages.length < maxPages) {
    const batch = queue.splice(0, Math.min(REQUEST_CONCURRENCY, maxPages - pages.length))
    const results = await Promise.all(
      batch.map(async (item) => ({
        item,
        result: await fetchPage(
          item.url,
          impl,
          timeoutMs,
          entry.origin,
          maxBodyBytes,
          options.headers,
        ),
      })),
    )

    for (const { item, result } of results) {
      if (!result.ok) {
        failures.push({ url: item.url.href, reason: result.reason })
        continue
      }
      const { url, html } = result.value
      if (url.href !== item.url.href) {
        redirects.push({ requested: item.url.href, landedOn: url.href })
      }
      pages.push({
        // The URL is the identity here; there is no file on disk. absolutePath
        // is the page's own href so that anything reaching for it gets
        // something true rather than a path that does not exist.
        absolutePath: url.href,
        relativePath: pageIdentity(url),
        html: stripBom(html),
      })
      options.onProgress?.(pages.length, queue.length)

      // Link discovery still runs when a sitemap seeded the queue: a sitemap
      // that lists three of forty pages is worse than no sitemap if it stops
      // the crawl there.
      if (item.depth < maxDepth) {
        for (const link of linksFrom(html, url)) enqueue(link, item.depth + 1)
      }
    }
  }

  return {
    pages: byIdentity(pages),
    origin: entry.origin,
    failures,
    redirects,
    // Anything still queued when the loop stopped is a page the caller asked
    // for and is not getting, which they have to be told about.
    truncated: queue.length > 0,
    discovery,
  }
}

/**
 * The requested URLs that a login wall swallowed, or none.
 *
 * A redirect on its own says nothing: sites normalise trailing slashes and send
 * `/` to `/en/` all day. What is not ordinary is *several* different URLs
 * answering at one address, or a whole crawl coming back as the single page the
 * entry was redirected to. Both are the shape of a sign-in page standing in
 * front of the site, and both otherwise produce a report about a page nobody
 * asked for that says it audited everything it set out to.
 *
 * Returns what was asked for and never reached, which is the one thing the run
 * has to say out loud. Deliberately shy of naming the cause: a single-page site
 * that redirects its entry looks identical from here, and being told where the
 * run actually landed is useful either way.
 */
export function collapsedOnto(result: CrawlResult): Array<{ requested: string; landedOn: string }> {
  if (result.redirects.length === 0) return []

  const byDestination = new Map<string, string[]>()
  for (const redirect of result.redirects) {
    byDestination.set(redirect.landedOn, [
      ...(byDestination.get(redirect.landedOn) ?? []),
      redirect.requested,
    ])
  }

  const collapsed: Array<{ requested: string; landedOn: string }> = []
  for (const [landedOn, requested] of byDestination) {
    // Two URLs answering at one address, or a crawl that came back as nothing
    // but the page it was redirected to.
    if (requested.length > 1 || result.pages.length === 1) {
      for (const from of requested) collapsed.push({ requested: from, landedOn })
    }
  }
  return collapsed
}

/**
 * One page per identity, in a stable order.
 *
 * The queue already refuses a URL it has seen, so this catches the case the
 * queue cannot: two different URLs that redirect to the same page. Sorting is
 * what makes two crawls of one site produce the same report even though the
 * requests finish in whatever order the server answers them.
 */
function byIdentity(pages: readonly CollectedPage[]): CollectedPage[] {
  const seen = new Set<string>()
  return pages
    .filter((page) => {
      if (seen.has(page.relativePath)) return false
      seen.add(page.relativePath)
      return true
    })
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}
