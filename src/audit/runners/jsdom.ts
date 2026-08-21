import { pathToFileURL } from 'node:url'
import { Script } from 'node:vm'
import axe from 'axe-core'
import { JSDOM, VirtualConsole } from 'jsdom'
import type { CollectedPage } from '../collect.ts'
import {
  type BlindRule,
  DEFAULT_TAGS,
  failedPage,
  type PageAudit,
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
export { DEFAULT_TAGS } from '../result.ts'

/**
 * Rules this engine structurally cannot decide.
 *
 * jsdom has no layout: every element reports a 0x0 box, computed style is
 * limited to the inline cascade, and nothing is ever fetched. axe-core does not
 * know that, so it happily returns `pass` for some of these — `target-size`
 * passes on any page because a 0x0 target gets measured against nothing, and
 * `color-contrast` passes on pages whose colours were never computed. Both were
 * observed on real sites. Reporting either as a pass would be a false clean
 * bill of health, so every rule listed here is force-reported as incomplete no
 * matter which bucket axe-core put it in.
 *
 * The browser runner passes an empty map instead: with real layout these rules
 * are exactly the ones it exists to answer.
 *
 * Rules tagged `experimental` are listed for completeness but filtered out at
 * scope time: axe-core does not run them by default, so a browser run would not
 * evaluate them either and telling the user to re-run with --browser would be
 * misleading.
 */
export const ENGINE_BLIND_RULES: Readonly<Record<string, BlindRule>> = {
  'color-contrast': {
    detail: 'needs rendered foreground and background colours',
    applicabilityUnreliable: false,
  },
  'color-contrast-enhanced': {
    detail: 'needs rendered foreground and background colours',
    applicabilityUnreliable: false,
  },
  'target-size': {
    detail: 'needs element geometry; every box is 0x0 without layout',
    applicabilityUnreliable: false,
  },
  'scrollable-region-focusable': {
    detail: 'needs computed overflow',
    applicabilityUnreliable: true,
  },
  'link-in-text-block': {
    detail: 'needs rendered colours and text decoration',
    applicabilityUnreliable: true,
  },
  'no-autoplay-audio': {
    detail: 'needs media duration, and media is never loaded',
    applicabilityUnreliable: true,
  },
  'avoid-inline-spacing': {
    detail: 'needs computed spacing after the full cascade',
    applicabilityUnreliable: false,
  },
  // Experimental in axe-core, so never actually run; see the note above.
  'p-as-heading': {
    detail: 'needs computed font size and weight',
    applicabilityUnreliable: false,
  },
  'css-orientation-lock': {
    detail: 'needs CSS media query evaluation',
    applicabilityUnreliable: true,
  },
}

/** Per-page ceiling; one pathological document must not stall a CI run. */
const DEFAULT_TIMEOUT_MS = 30_000

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
      pageAxe.run(dom.window.document, runOptions(tags)),
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

const blindScopeCache = new Map<string, Map<string, BlindRule>>()

/**
 * Blind rules the requested tag filter would actually have run. Experimental
 * rules are excluded: axe-core leaves them off by default, so a browser run
 * would not have evaluated them either.
 */
export function blindRulesInScope(tags: readonly string[]): Map<string, BlindRule> {
  const key = [...tags].sort().join(',')
  const cached = blindScopeCache.get(key)
  if (cached) return cached

  const inScope = new Map<string, BlindRule>()
  for (const rule of axe.getRules([...tags])) {
    if (rule.tags.includes('experimental')) continue
    const blind = ENGINE_BLIND_RULES[rule.ruleId]
    if (blind) inScope.set(rule.ruleId, blind)
  }
  blindScopeCache.set(key, inScope)
  return inScope
}

function pageUrl(page: CollectedPage, baseUrl?: string): string {
  if (!baseUrl) return pathToFileURL(page.absolutePath).href
  return new URL(page.relativePath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href
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
