import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AxeResults } from 'axe-core'
import axe from 'axe-core'
import type { CollectedPage } from '../collect.ts'
import { DEFAULT_TAGS, failedPage, type PageAudit, runOptions, shapeResults } from '../result.ts'
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
}

/** Desktop-ish default; large enough that nothing collapses to a mobile layout. */
const DEFAULT_VIEWPORT = { width: 1280, height: 720 }

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
    throw cause
  }

  try {
    // bypassCSP, because a site that sets a Content-Security-Policy would
    // otherwise refuse the injected axe-core as an inline script and every page
    // would come back unaudited. Observed on a real build the first time this
    // ran outside the fixtures.
    const context = await browser.newContext({ viewport, bypassCSP: true })
    const audits: PageAudit[] = []

    for (const page of pages) {
      audits.push(await auditOne(context, server?.origin, page, { tags, timeout, ...options }))
    }

    await context.close()
    return audits
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
    url: reportedUrl(page, options.baseUrl),
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

function reportedUrl(page: CollectedPage, baseUrl?: string): string {
  if (!baseUrl) return pathToFileURL(page.absolutePath).href
  return new URL(page.relativePath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href
}

/** The bits of playwright this runner uses, so the import can stay dynamic. */
interface BrowserContextLike {
  newPage(): Promise<PageLike>
  close(): Promise<void>
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
 * Playwright is an optional peer dependency: the browserless path must never
 * pay for a Chromium download. Both failure modes get their own instruction,
 * because "install playwright" and "install the browser binary" are different
 * problems with different fixes.
 */
export async function loadChromium(cwd = process.cwd()): Promise<ChromiumLike> {
  let module: { chromium?: ChromiumLike } | undefined

  // From the audited project first, and only then from here.
  //
  // A bare `import('playwright')` resolves against this module's own location.
  // Run through npx — which is how most people run this — that location is a
  // cache directory that has no playwright in it, while the project the tool
  // was pointed at does. The result was the install instructions being printed
  // to somebody who had just followed them.
  try {
    const require = createRequire(pathToFileURL(path.join(cwd, 'package.json')).href)
    const resolved = require.resolve('playwright')
    module = (await import(pathToFileURL(resolved).href)) as { chromium?: ChromiumLike }
  } catch {
    // Not in the project; fall through to this package's own resolution.
  }

  if (module === undefined) {
    try {
      module = (await import('playwright')) as { chromium?: ChromiumLike }
    } catch {
      throw new BrowserUnavailableError(
        'Browser mode needs Playwright, which is an optional peer dependency.\n' +
          '  Install it with:  npm i -D playwright\n' +
          '  Then the browser: npx playwright install chromium',
      )
    }
  }

  if (!module.chromium) {
    throw new BrowserUnavailableError('Playwright is installed but exports no chromium launcher')
  }
  return module.chromium
}
