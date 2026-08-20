import { pathToFileURL } from 'node:url'
import { Script } from 'node:vm'
import type { AxeResults, ImpactValue, NodeResult, Result, RunOptions } from 'axe-core'
import axe from 'axe-core'
import { JSDOM, VirtualConsole } from 'jsdom'
import type { CollectedPage } from '../collect.ts'

/** WCAG 2.2 AA and everything it builds on. Best-practice rules stay off. */
export const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

export interface BlindRule {
  /** Why this engine cannot decide the rule. Shown to the user. */
  detail: string
  /**
   * True when axe-core calling the rule *inapplicable* proves nothing either,
   * because finding the candidate elements is itself layout- or media-
   * dependent. `no-autoplay-audio` reports inapplicable even on a page with
   * `<audio autoplay>`, because the duration it matches on never loads.
   *
   * When false, an inapplicable verdict is DOM-determinable and trustworthy,
   * so the rule is left out of the report rather than adding noise.
   */
  applicabilityUnreliable: boolean
}

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

export type IncompleteReason = 'needs-review' | 'engine-limitation'

export interface FindingNode {
  /** Outer HTML of the offending element, as axe-core captured it. */
  html: string
  /** CSS selector path to the element. */
  target: string[]
  failureSummary?: string
}

/** A rule and what it maps to in the standards, without a verdict attached. */
export interface RuleOutcome {
  ruleId: string
  help: string
  helpUrl: string
  /** WCAG success criteria, e.g. ['1.1.1']. */
  successCriteria: string[]
  /** EN 301 549 clauses, e.g. ['9.1.1.1'] — quoted by the statement generator. */
  enClauses: string[]
  tags: string[]
}

export interface Finding extends RuleOutcome {
  impact: ImpactValue
  nodes: FindingNode[]
}

export interface IncompleteFinding extends Finding {
  /**
   * `needs-review` — axe-core wants a human decision; a browser run would say
   * the same. `engine-limitation` — this engine could not evaluate the rule at
   * all, so re-run with --browser to get a verdict.
   */
  reason: IncompleteReason
  reasonDetail: string
}

/**
 * One page's result, keeping axe-core's four outcomes distinct.
 *
 * Every in-scope rule lands in exactly one of the four arrays. They are not
 * interchangeable and must not be summed into a single "checked" number: only
 * `passes` is evidence that a criterion was met on this page. `inapplicable`
 * means the rule found nothing to check, which says nothing about compliance —
 * a page with no images trivially "passes" nothing about image alternatives.
 */
export interface PageAudit {
  relativePath: string
  absolutePath: string
  /** Document URL used while auditing; affects how relative hrefs resolve. */
  url: string
  engine: 'jsdom'
  /** Rules that matched elements and failed. */
  violations: Finding[]
  /** No verdict reached: either a human must decide, or this engine is blind. */
  incomplete: IncompleteFinding[]
  /**
   * Rules that matched elements and were met. Never contains a rule from
   * ENGINE_BLIND_RULES, so a pass here always means the rule was evaluated.
   *
   * Deliberately carries no element count: `resultTypes` limits node detail to
   * the buckets shown to the user, so any count taken from here would be capped
   * at one and read as a lie.
   */
  passes: RuleOutcome[]
  /**
   * Rules with no matching elements on this page. Not a pass, not a failure,
   * and never evidence of compliance.
   */
  inapplicable: RuleOutcome[]
  durationMs: number
  /** Set when the page could not be audited at all; other fields stay empty. */
  error?: string
}

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
    return toPageAudit(page, url, results, tags, Date.now() - startedAt)
  } catch (cause) {
    return {
      relativePath: page.relativePath,
      absolutePath: page.absolutePath,
      url,
      engine: 'jsdom',
      violations: [],
      incomplete: [],
      passes: [],
      inapplicable: [],
      durationMs: Date.now() - startedAt,
      error: cause instanceof Error ? cause.message : String(cause),
    }
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

function runOptions(tags: readonly string[]): RunOptions {
  return {
    runOnly: { type: 'tag', values: [...tags] },
    // Full node detail only where it is actually shown to the user.
    resultTypes: ['violations', 'incomplete'],
    // axe-core preloads stylesheets and media metadata for a handful of rules.
    // Nothing is ever fetched here, so each of those rules instead burns its
    // full 10s timeout: a real 300-node page took 10.4s with preload on and
    // 654ms with it off, for identical findings. The affected rules are blind
    // to us anyway.
    preload: false,
  }
}

function toPageAudit(
  page: CollectedPage,
  url: string,
  results: AxeResults,
  tags: readonly string[],
  durationMs: number,
): PageAudit {
  const blind = blindRulesInScope(tags)

  const violations: Finding[] = []
  const incomplete: IncompleteFinding[] = []
  const passes: RuleOutcome[] = []
  const inapplicable: RuleOutcome[] = []

  // A blind rule's verdict is discarded whichever bucket axe-core put it in: a
  // violation derived from a 0x0 box is as untrustworthy as a pass. Its nodes
  // are kept, since they are still the elements a human needs to look at.
  for (const result of results.violations) {
    const rule = blind.get(result.id)
    if (rule) incomplete.push(toIncomplete(result, 'engine-limitation', rule.detail))
    else violations.push(toFinding(result))
  }

  for (const result of results.passes) {
    const rule = blind.get(result.id)
    if (rule) incomplete.push(toIncomplete(result, 'engine-limitation', rule.detail))
    else passes.push(toOutcome(result))
  }

  for (const result of results.incomplete) {
    const rule = blind.get(result.id)
    incomplete.push(
      rule
        ? toIncomplete(result, 'engine-limitation', rule.detail)
        : toIncomplete(result, 'needs-review', result.description),
    )
  }

  // An inapplicable verdict is only worth recording when the rule's own matcher
  // could do its job. Where it could not, filing it as "nothing to check" would
  // hide the finding — no-autoplay-audio reports inapplicable even on a page
  // with autoplaying audio.
  for (const result of results.inapplicable) {
    const rule = blind.get(result.id)
    if (rule?.applicabilityUnreliable) {
      incomplete.push(toIncomplete(result, 'engine-limitation', rule.detail))
    } else {
      inapplicable.push(toOutcome(result))
    }
  }

  // Rules axe-core skipped entirely, e.g. the preload-dependent ones. Silence
  // would read as coverage this run never had.
  const seen = new Set([
    ...violations.map((finding) => finding.ruleId),
    ...incomplete.map((finding) => finding.ruleId),
    ...passes.map((outcome) => outcome.ruleId),
    ...inapplicable.map((outcome) => outcome.ruleId),
  ])
  for (const [ruleId, rule] of blind) {
    if (seen.has(ruleId)) continue
    const metadata = ruleMetadata(ruleId)
    if (!metadata) continue
    incomplete.push({
      ruleId,
      impact: null,
      help: metadata.help,
      helpUrl: metadata.helpUrl,
      successCriteria: successCriteria(metadata.tags),
      enClauses: enClauses(metadata.tags),
      tags: metadata.tags,
      nodes: [],
      reason: 'engine-limitation',
      reasonDetail: rule.detail,
    })
  }

  return {
    relativePath: page.relativePath,
    absolutePath: page.absolutePath,
    url,
    engine: 'jsdom',
    violations,
    incomplete: incomplete.sort(byRuleId),
    passes: passes.sort(byRuleId),
    inapplicable: inapplicable.sort(byRuleId),
    durationMs,
  }
}

function byRuleId(a: RuleOutcome, b: RuleOutcome): number {
  return a.ruleId.localeCompare(b.ruleId)
}

function toOutcome(result: Result): RuleOutcome {
  return {
    ruleId: result.id,
    help: result.help,
    helpUrl: result.helpUrl,
    successCriteria: successCriteria(result.tags),
    enClauses: enClauses(result.tags),
    tags: result.tags,
  }
}

function toFinding(result: Result): Finding {
  return {
    ...toOutcome(result),
    impact: result.impact ?? null,
    nodes: result.nodes.map(toFindingNode),
  }
}

function toIncomplete(result: Result, reason: IncompleteReason, detail: string): IncompleteFinding {
  return { ...toFinding(result), reason, reasonDetail: detail }
}

function toFindingNode(node: NodeResult): FindingNode {
  return {
    html: node.html,
    target: node.target.map((selector) => String(selector)),
    ...(node.failureSummary ? { failureSummary: node.failureSummary } : {}),
  }
}

const blindScopeCache = new Map<string, Map<string, BlindRule>>()

/**
 * Blind rules the requested tag filter would actually have run. Experimental
 * rules are excluded: axe-core leaves them off by default, so a browser run
 * would not have evaluated them either.
 */
function blindRulesInScope(tags: readonly string[]): Map<string, BlindRule> {
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

interface RuleDocs {
  help: string
  helpUrl: string
  tags: string[]
}

function ruleMetadata(ruleId: string): RuleDocs | undefined {
  const rule = axe.getRules().find((candidate) => candidate.ruleId === ruleId)
  if (!rule) return undefined
  return { help: rule.description, helpUrl: rule.helpUrl, tags: rule.tags }
}

/** `wcag143` -> `1.4.3`, `wcag258` -> `2.5.8`, `wcag2411` -> `2.4.11`. */
function successCriteria(tags: readonly string[]): string[] {
  const criteria = new Set<string>()
  for (const tag of tags) {
    const match = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag)
    if (match?.[1] && match[2] && match[3]) {
      criteria.add(`${match[1]}.${match[2]}.${match[3]}`)
    }
  }
  return [...criteria].sort()
}

/** `EN-9.1.4.3` -> `9.1.4.3`. */
function enClauses(tags: readonly string[]): string[] {
  const clauses = new Set<string>()
  for (const tag of tags) {
    const match = /^EN-(\d+(?:\.\d+)+)$/.exec(tag)
    if (match?.[1]) clauses.add(match[1])
  }
  return [...clauses].sort()
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
