import { Script } from 'node:vm'
import axe from 'axe-core'
import { JSDOM, VirtualConsole } from 'jsdom'
import type { CollectedPage } from '../collect.ts'
import {
  type BlindRule,
  blindRulesInScope,
  DEFAULT_PAGE_TIMEOUT_MS,
  DEFAULT_TAGS,
  failedPage,
  type PageAudit,
  pageUrl,
  runOptions,
  shapeResults,
} from '../result.ts'

export type {
  BlindRule,
  Finding,
  FindingNode,
  IncompleteFinding,
  IncompleteReason,
  PageAudit,
  RuleOutcome,
} from '../result.ts'
export {
  blindRulesInScope,
  DEFAULT_PAGE_TIMEOUT_MS,
  DEFAULT_TAGS,
  ENGINE_BLIND_RULES,
} from '../result.ts'

/**
 * Per-page ceiling.
 *
 * A soft one, and the limit is worth stating: this races axe-core against a
 * timer, so it only fires where the work yields to the event loop. Neither
 * jsdom's parse nor axe-core's walk of the tree does, so a document pathological
 * enough to hold the thread runs past this unimpeded. The hard ceiling is the
 * worker pool's, which terminates the thread; see the note on `runWorkers`.
 */
const DEFAULT_TIMEOUT_MS = DEFAULT_PAGE_TIMEOUT_MS

export interface JsdomRunnerOptions {
  /** axe-core tag filter. Defaults to DEFAULT_TAGS. */
  tags?: readonly string[]
  /** Per-page timeout in milliseconds. */
  timeoutMs?: number
  /**
   * Site origin, e.g. https://example.com. When set, each page is audited under
   * its real URL instead of a file:// one.
   */
  baseUrl?: string
  /**
   * Skip the rules this engine structurally cannot decide instead of running
   * them and discarding the answer. Faster, and it costs the element lists for
   * those rules — see `runOptions`.
   */
  fast?: boolean
}

/**
 * Audit collected pages with axe-core inside jsdom.
 *
 * Pages are processed sequentially: jsdom parsing and axe-core are both
 * CPU-bound on the main thread, so concurrency buys nothing here. A page that
 * throws or times out is recorded with an `error` and the run continues.
 */
export async function runJsdomAudit(
  pages: readonly CollectedPage[],
  options: JsdomRunnerOptions = {},
): Promise<PageAudit[]> {
  const audits: PageAudit[] = []
  for (const page of pages) {
    audits.push(await auditPage(page, options))
  }
  return audits
}

export async function auditPage(
  page: CollectedPage,
  options: JsdomRunnerOptions = {},
): Promise<PageAudit> {
  const tags = options.tags ?? DEFAULT_TAGS
  const url = pageUrl(page, options.baseUrl)
  const startedAt = Date.now()
  const identity = {
    relativePath: page.relativePath,
    absolutePath: page.absolutePath,
    url,
    engine: 'jsdom' as const,
  }

  let dom: JSDOM | undefined
  try {
    dom = createDom(page.html, url)
    injectAxe(dom)
    // axe-core was evaluated into the window, so it is not on jsdom's type.
    const { axe: pageAxe } = dom.window as unknown as { axe: typeof axe }
    const results = await withTimeout(
      pageAxe.run(dom.window.document, runOptions(tags, { skipBlindRules: options.fast === true })),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    return shapeResults(results, {
      ...identity,
      durationMs: Date.now() - startedAt,
      blind: blindRulesInScope(tags),
    })
  } catch (cause) {
    return failedPage(
      { ...identity, durationMs: Date.now() - startedAt },
      cause instanceof Error ? cause.message : String(cause),
    )
  } finally {
    dom?.window.close()
  }
}

function createDom(html: string, url: string): JSDOM {
  const virtualConsole = new VirtualConsole()
  // Real builds carry CSS jsdom cannot parse and markup it dislikes. Neither is
  // an accessibility finding, so none of it belongs in the user's terminal.
  virtualConsole.on('jsdomError', () => {})

  return new JSDOM(html, {
    url,
    virtualConsole,
    // Page scripts stay unexecuted — a build-time audit must not run the site's
    // JavaScript — but window.eval is needed to inject axe-core.
    runScripts: 'outside-only',
    // axe-core schedules work through requestAnimationFrame.
    pretendToBeVisual: true,
    // Deliberately no `resources: 'usable'`: an audit must not fetch anything.
    // The cost is that CSS-driven visibility is invisible to us, which is part
    // of why ENGINE_BLIND_RULES exists.
  })
}

/**
 * axe-core is 1.3 MB of source. Compiling it once and re-running the compiled
 * script in each window's context avoids re-parsing it for every page.
 */
let axeScript: Script | undefined

function injectAxe(dom: JSDOM): void {
  axeScript ??= new Script(axe.source, { filename: 'axe-core.js' })
  axeScript.runInContext(dom.getInternalVMContext())
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // A late rejection from the loser of the race must not surface as an
  // unhandled rejection once the timeout has already been reported.
  promise.catch(() => {})

  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`axe-core timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
