import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AxeResults } from 'axe-core'
import axe from 'axe-core'
import type { CollectedPage } from '../collect.ts'
import {
  DEFAULT_TAGS,
  failedPage,
  type PageAudit,
  pageUrl,
  runOptions,
  shapeResults,
} from '../result.ts'
import { serveDirectory } from '../serve.ts'

/** Per-page ceiling. Real pages fetch real resources, so it is looser. */
const DEFAULT_TIMEOUT_MS = 60_000

export class BrowserUnavailableError extends Error {
  override readonly name = 'BrowserUnavailableError'
}

export interface BrowserRunnerOptions {
  /**
   * Project whose node_modules Playwright is resolved from. Defaults to the
   * process's. It is the audited project rather than this package's own
   * location, because under npx those are not the same place.
   */
  cwd?: string
  /** axe-core tag filter. Defaults to DEFAULT_TAGS. */
  tags?: readonly string[]
  /** Per-page timeout in milliseconds. */
  timeoutMs?: number
  /** Site origin recorded in the report, not the address actually visited. */
  baseUrl?: string
  /**
   * Viewport used for rendering. Affects target-size and anything else that
   * depends on layout, so it is reported alongside the results.
   */
  viewport?: { width: number; height: number }
  /**
   * Pages open at once. Defaults to DEFAULT_CONCURRENCY, and 1 audits them one
   * after another as this runner used to.
   */
  concurrency?: number
  /**
   * Extra request headers, for a site behind a login or preview protection.
   * Added to every request to the audited site's own origin, page and asset
   * alike, and to nothing else. Credentials: never recorded in a report.
   */
  headers?: Record<string, string>
}

/** Desktop-ish default; large enough that nothing collapses to a mobile layout. */
const DEFAULT_VIEWPORT = { width: 1280, height: 720 }

/**
 * Pages open at once.
 *
 * This runner used to audit strictly one page at a time while the browserless
 * one had a whole measured worker pool — which had it backwards, since the
 * browser is the slow engine: it fetches the stylesheets and images a real
 * visitor would, and spends most of a page waiting on them rather than on the
 * CPU. Waiting on four at once is close to free.
 *
 * Four rather than more because each open page holds a document tree, its
 * decoded images and its own copy of axe-core, and Chromium's memory is the
 * limit here rather than cores. Past this the gain flattens and the cost does
 * not.
 */
const DEFAULT_CONCURRENCY = 4

/**
 * Audit a built site in real Chromium.
 *
 * This is the engine that can answer the rules jsdom is blind to: colour
 * contrast, target size, computed overflow. Nothing is force-reported as
 * unevaluated here, because with layout and CSS there is no reason to.
 *
 * Two differences from the browserless path are deliberate and worth knowing:
 * the page's own JavaScript runs, so client-rendered content is audited as a
 * visitor would see it; and the build is served over loopback rather than
 * opened as a file, so absolute asset paths resolve.
 */
export async function runBrowserAudit(
  /**
   * Build directory to serve the pages from, or undefined when they came off a
   * running site and already have somewhere real to be fetched from. Serving a
   * crawled page back from disk would audit a copy of the markup with the
   * server that produced it cut out of the picture.
   */
  directory: string | undefined,
  pages: readonly CollectedPage[],
  options: BrowserRunnerOptions = {},
): Promise<PageAudit[]> {
  if (pages.length === 0) return []

  const chromium = await loadChromium(options.cwd)
  const tags = options.tags ?? DEFAULT_TAGS
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const viewport = options.viewport ?? DEFAULT_VIEWPORT

  const server = directory === undefined ? undefined : await serveDirectory(directory)

  // Launch inside its own guard. The server is already listening, and a launch
  // that throws — a Chromium that was never downloaded is the common one —
  // would otherwise leave it holding the event loop open, so the run hangs
  // instead of reporting the failure.
  let browser: BrowserLike
  try {
    browser = await chromium.launch({ headless: true })
  } catch (cause) {
    await server?.close()
    throw launchFailure(cause)
  }

  try {
    // bypassCSP, because a site that sets a Content-Security-Policy would
    // otherwise refuse the injected axe-core as an inline script and every page
    // would come back unaudited. Observed on a real build the first time this
    // ran outside the fixtures.
    const context = await browser.newContext({ viewport, bypassCSP: true })

    // Credentials for a staging site or a preview deployment, on every request
    // to that site: a protected site protects its assets too, and a page
    // audited without its stylesheet is a page audited wrong. Only to that
    // site. They used to be set as the context's extraHTTPHeaders, which
    // Chromium sends on every request a page makes, so the fonts, analytics
    // and CDN scripts of the audited site all received the preview token too.
    if (options.headers !== undefined) {
      const credentials = options.headers
      const origins = siteOrigins(pages, server?.origin)
      await context.route('**/*', credentialsRoute(origins, credentials))
    }

    // Indexed by position rather than pushed in completion order: the pages
    // finish in whatever order the server answers them, and two runs of one
    // build have to produce the same report.
    const audits: Array<PageAudit | undefined> = Array.from({ length: pages.length })
    const lanes = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, pages.length))
    let next = 0

    // One shared queue drained by `lanes` workers, so a slow page holds up only
    // its own lane. Each opens its own tab per page and closes it again, which
    // is what `auditOne` already did — the only change is how many are in
    // flight at once.
    await Promise.all(
      Array.from({ length: lanes }, async () => {
        while (true) {
          const index = next
          if (index >= pages.length) return
          next += 1
          audits[index] = await auditOne(context, server?.origin, pages[index] as CollectedPage, {
            tags,
            timeout,
            ...options,
          })
        }
      }),
    )

    await context.close()
    // Every slot is filled: auditOne turns a page it cannot audit into a
    // PageAudit carrying an error rather than throwing.
    return audits as PageAudit[]
  } finally {
    await browser.close()
    await server?.close()
  }
}

interface AuditOneOptions extends BrowserRunnerOptions {
  tags: readonly string[]
  timeout: number
}

async function auditOne(
  context: BrowserContextLike,
  /** Loopback origin serving the build, or undefined for a crawled page. */
  origin: string | undefined,
  page: CollectedPage,
  options: AuditOneOptions,
): Promise<PageAudit> {
  const startedAt = Date.now()
  const identity = {
    relativePath: page.relativePath,
    absolutePath: page.absolutePath,
    // The loopback port is ephemeral and would churn between runs, so the
    // report carries the same logical URL the browserless engine would use.
    url: pageUrl(page, options.baseUrl),
    engine: 'browser' as const,
  }

  const tab = await context.newPage()
  try {
    tab.setDefaultTimeout(options.timeout)
    // A crawled page carries its own URL, already encoded by whoever linked
    // to it; a page off disk has to be placed under the loopback origin.
    const target = origin === undefined ? page.absolutePath : servedUrl(origin, page.relativePath)
    const response = await tab.goto(target, { waitUntil: 'load', timeout: options.timeout })

    if (response && response.status() >= 400) {
      throw new Error(`Served ${page.relativePath} with HTTP ${response.status()}`)
    }

    await tab.addScriptTag({ content: axe.source })
    const results = (await tab.evaluate(
      // Serialised into the page, so it cannot close over anything here.
      ([runnerOptions]) =>
        (globalThis as unknown as { axe: { run: (o: unknown) => Promise<unknown> } }).axe.run(
          runnerOptions,
        ),
      // preload is on: a real browser can fetch the stylesheets and media that
      // the rules jsdom gives up on actually need.
      [{ ...runOptions(options.tags), preload: true }] as const,
    )) as AxeResults

    return shapeResults(results, {
      ...identity,
      durationMs: Date.now() - startedAt,
      blind: new Map(),
    })
  } catch (cause) {
    return failedPage(
      { ...identity, durationMs: Date.now() - startedAt },
      cause instanceof Error ? cause.message : String(cause),
    )
  } finally {
    await tab.close()
  }
}

/**
 * Where the local server will hand this page over.
 *
 * Encoded per segment: a build with `#` or `?` in a filename would otherwise
 * have the browser read the rest of the path as a fragment or a query and audit
 * the wrong page, or none at all. The browserless engine gets this for free
 * from pathToFileURL; this path has to do it by hand.
 */
export function servedUrl(origin: string, relativePath: string): string {
  return `${origin}/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

/** The bits of playwright this runner uses, so the import can stay dynamic. */
export interface RouteLike {
  request(): { url(): string; headers(): Record<string, string> }
  continue(): Promise<void>
  fetch(options: { headers: Record<string, string>; maxRedirects: number }): Promise<unknown>
  fulfill(options: { response: unknown }): Promise<void>
  abort(): Promise<void>
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>
  route(url: string, handler: (route: RouteLike) => Promise<void>): Promise<void>
  close(): Promise<void>
}

/**
 * A route handler that adds `credentials` to requests for `origins`, and to
 * nothing else, redirects included.
 *
 * Requests to the site are fetched here and handed back, not continued with
 * the headers added: Playwright carries a continued request's header
 * overrides onto every redirect hop, so a page or asset on the site that
 * redirected elsewhere took the credentials with it. With no redirects
 * followed here, a 3xx goes back to the browser, which follows it as a new
 * request; that one is routed again, and leaves the site bare.
 *
 * One side effect, on the safe side: Chromium treats a document handed back
 * this way as public, so it may not load assets from another loopback or
 * private address. Turning that check off would let an audited page probe the
 * network of the machine running the audit.
 */
export function credentialsRoute(
  origins: ReadonlySet<string>,
  credentials: Record<string, string>,
): (route: RouteLike) => Promise<void> {
  return async (route) => {
    const request = route.request()
    if (!origins.has(originOf(request.url()))) return route.continue()
    try {
      const response = await route.fetch({
        headers: { ...request.headers(), ...credentials },
        maxRedirects: 0,
      })
      return await route.fulfill({ response })
    } catch {
      // Unreachable, timed out, or the page went away: the failure the browser
      // would have recorded, without a retry that could send the credentials
      // anywhere else.
      return route.abort()
    }
  }
}

/**
 * The origins credentials may go to: those of the crawled pages, which a crawl
 * keeps to one origin, and the loopback server for a build off disk.
 */
export function siteOrigins(
  pages: readonly CollectedPage[],
  serverOrigin: string | undefined,
): Set<string> {
  const origins = new Set<string>()
  if (serverOrigin !== undefined) origins.add(serverOrigin)
  for (const page of pages) {
    const origin = originOf(page.absolutePath)
    if (origin.startsWith('http')) origins.add(origin)
  }
  return origins
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'null'
  }
}

interface PageLike {
  setDefaultTimeout(timeout: number): void
  goto(
    url: string,
    options?: { waitUntil?: 'load'; timeout?: number },
  ): Promise<{ status(): number } | null>
  addScriptTag(options: { content: string }): Promise<unknown>
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>
  close(): Promise<void>
}

interface BrowserLike {
  newContext(options?: {
    viewport?: { width: number; height: number }
    bypassCSP?: boolean
  }): Promise<BrowserContextLike>
  close(): Promise<void>
}

interface ChromiumLike {
  launch(options?: { headless?: boolean }): Promise<BrowserLike>
}

/**
 * A launch that failed because the browser was never downloaded, told as setup.
 *
 * The third setup failure, and the only one that used to arrive as a crash.
 * `npm i -D playwright` does not fetch Chromium, so somebody who followed the
 * install line exactly still lands here — and what they saw was Playwright's
 * message boxed in ASCII, wrapped in a stack trace through this package's
 * bundled internals. That reads as eaa-kit falling over, not as a step left to
 * run, and the two want very different things from the reader.
 *
 * Anything else is passed through untouched: a launch can fail for reasons
 * that really are bugs, and dressing those up as setup advice would send
 * somebody off installing a browser they already have.
 */
function launchFailure(cause: unknown): unknown {
  if (!(cause instanceof Error)) return cause
  const missing = /Executable doesn't exist at (.+)/.exec(cause.message)
  if (missing === null) return cause

  return new BrowserUnavailableError(
    'Playwright is installed, but the Chromium it drives is not.\n' +
      '  Download it with:  npx playwright install chromium\n' +
      `  It was looked for at: ${missing[1]?.trim() ?? 'an unreported path'}`,
  )
}

/**
 * Playwright is an optional peer dependency: the browserless path must never
 * pay for a Chromium download. Both failure modes get their own instruction,
 * because "install playwright" and "install the browser binary" are different
 * problems with different fixes.
 */
export async function loadChromium(cwd = process.cwd()): Promise<ChromiumLike> {
  const tried: string[] = []

  // The project being audited first, and only then this package.
  //
  // A bare `import('playwright')` resolves against this module's own location.
  // Run through npx — which is how most people run this — that location is a
  // cache directory with no playwright in it, while the project the tool was
  // pointed at does have one. The result was the install instructions being
  // printed to somebody who had just followed them.
  //
  // @playwright/test is included because it is what most projects actually
  // install, and it re-exports the same launchers.
  //
  // The project's own install is looked for on its own first. `require.resolve`
  // also searches NODE_PATH and the global folders, so a global `playwright`
  // used to win over the `@playwright/test` the project had installed, and the
  // run drove whichever Chromium that global copy happened to pair with.
  const specifiers = ['playwright', '@playwright/test']
  const passes: Array<{ root: string | undefined; installedIn?: string }> = [
    { root: cwd, installedIn: cwd },
    { root: cwd },
    { root: undefined },
  ]
  const seen = new Set<unknown>()

  for (const { root, installedIn } of passes) {
    for (const specifier of specifiers) {
      const loaded = await tryLoad(specifier, root, installedIn)
      if (loaded === undefined || seen.has(loaded)) continue
      seen.add(loaded)
      tried.push(`${specifier}${root === undefined ? ' (from eaa-kit)' : ''}`)
      const chromium = launcherIn(loaded)
      if (chromium !== undefined) return chromium
    }
  }

  if (tried.length === 0) {
    throw new BrowserUnavailableError(
      'Browser mode needs Playwright, which is an optional peer dependency.\n' +
        '  Install it with:  npm i -D playwright\n' +
        '  Then the browser: npx playwright install chromium',
    )
  }

  // Resolved something, and it was not usable. Naming what was found and what
  // it exported is the difference between a report somebody can act on and one
  // that only says the tool is unhappy.
  throw new BrowserUnavailableError(
    `Found ${tried.join(' and ')}, but no chromium launcher on it.\n` +
      '  This usually means an incomplete or mismatched install. Try:\n' +
      '    npm i -D playwright@latest\n' +
      '    npx playwright install chromium --force',
  )
}

/** Import a specifier, resolved from `root` when given. Undefined if absent. */
async function tryLoad(
  specifier: string,
  root: string | undefined,
  /** Accept only a copy installed for this project, not one found on NODE_PATH. */
  installedIn?: string,
): Promise<unknown> {
  try {
    if (root === undefined) return await import(specifier)
    const require = createRequire(pathToFileURL(path.join(root, 'package.json')).href)
    const resolved = require.resolve(specifier)
    if (installedIn !== undefined && !isInstalledFor(resolved, installedIn)) return undefined
    return await import(pathToFileURL(resolved).href)
  } catch {
    return undefined
  }
}

/**
 * Whether a resolved file came from the project's own dependencies: a
 * node_modules directory in the project or above it (a monorepo hoists to its
 * root), or Yarn's cache, which is where Plug'n'Play keeps them.
 */
export function isInstalledFor(
  resolved: string,
  project: string,
  /** Injectable so the Windows rules can be tested anywhere. */
  paths: typeof path = path,
): boolean {
  // Both sides absolute, and on Windows compared without case: a drive letter
  // can come back from require.resolve as c: and from the working directory
  // as C:, and NTFS does not care, so neither may this.
  const fold =
    paths.sep === '\\' ? (value: string) => value.toLowerCase() : (value: string) => value
  const file = fold(paths.resolve(resolved))
  let dir = fold(paths.resolve(project))
  for (;;) {
    for (const store of ['node_modules', '.yarn']) {
      if (file.startsWith(paths.join(dir, store) + paths.sep)) return true
    }
    const parent = paths.dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

/**
 * The chromium launcher, whichever shape the module came back in.
 *
 * Playwright is CommonJS. Whether `await import()` of it exposes named exports
 * depends on Node's static analysis of the file succeeding, which is not
 * guaranteed and differs between versions; when it does not, everything is on
 * `default` instead. Reading only the named export produced "installed but
 * exports no chromium launcher" against a perfectly good install.
 *
 * Exported for its own tests. Driving this through a real import under vitest
 * proves nothing: vitest hands CommonJS back through an interop proxy that
 * answers `.chromium` whether or not Node hoisted it, so both shapes look
 * identical from in there and the test passes with this function broken. The
 * shapes are checked here directly, and the real interop is exercised against
 * real Node by scripts/test-packaged.mjs.
 */
export function launcherIn(module: unknown): ChromiumLike | undefined {
  const candidates = [module, (module as { default?: unknown })?.default]
  for (const candidate of candidates) {
    const chromium = (candidate as { chromium?: ChromiumLike } | undefined)?.chromium
    if (chromium !== undefined && typeof chromium.launch === 'function') return chromium
  }
  return undefined
}
