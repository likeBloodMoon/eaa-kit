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
  directory: string,
  pages: readonly CollectedPage[],
  options: BrowserRunnerOptions = {},
): Promise<PageAudit[]> {
  if (pages.length === 0) return []

  const chromium = await loadChromium()
  const tags = options.tags ?? DEFAULT_TAGS
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const viewport = options.viewport ?? DEFAULT_VIEWPORT

  const server = await serveDirectory(directory)
  const browser = await chromium.launch({ headless: true })

  try {
    // bypassCSP, because a site that sets a Content-Security-Policy would
    // otherwise refuse the injected axe-core as an inline script and every page
    // would come back unaudited. Observed on a real build the first time this
    // ran outside the fixtures.
    const context = await browser.newContext({ viewport, bypassCSP: true })
    const audits: PageAudit[] = []

    for (const page of pages) {
      audits.push(await auditOne(context, server.origin, page, { tags, timeout, ...options }))
    }

    await context.close()
    return audits
  } finally {
    await browser.close()
    await server.close()
  }
}

interface AuditOneOptions extends BrowserRunnerOptions {
  tags: readonly string[]
  timeout: number
}

async function auditOne(
  context: BrowserContextLike,
  origin: string,
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
    const target = `${origin}/${page.relativePath.split(path.sep).join('/')}`
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

interface ChromiumLike {
  launch(options?: { headless?: boolean }): Promise<{
    newContext(options?: {
      viewport?: { width: number; height: number }
      bypassCSP?: boolean
    }): Promise<BrowserContextLike>
    close(): Promise<void>
  }>
}

/**
 * Playwright is an optional peer dependency: the browserless path must never
 * pay for a Chromium download. Both failure modes get their own instruction,
 * because "install playwright" and "install the browser binary" are different
 * problems with different fixes.
 */
async function loadChromium(): Promise<ChromiumLike> {
  let module: { chromium?: ChromiumLike }
  try {
    module = (await import('playwright')) as { chromium?: ChromiumLike }
  } catch {
    throw new BrowserUnavailableError(
      'Browser mode needs Playwright, which is an optional peer dependency.\n' +
        '  Install it with:  pnpm add -D playwright\n' +
        '  Then the browser: npx playwright install chromium',
    )
  }

  if (!module.chromium) {
    throw new BrowserUnavailableError('Playwright is installed but exports no chromium launcher')
  }
  return module.chromium
}
