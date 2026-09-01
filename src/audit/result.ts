import { pathToFileURL } from 'node:url'
import type { AxeResults, ImpactValue, NodeResult, Result, RunOptions } from 'axe-core'
import axe from 'axe-core'
import type { CollectedPage } from './collect.ts'

/**
 * Per-page ceiling for an audit, in milliseconds.
 *
 * Lives here rather than in the jsdom runner because the worker pool needs it
 * to set its own deadline, and the pool deliberately does not import jsdom —
 * loading 630 ms of dependency to supervise threads that each load their own
 * would be pure overhead. The same reason ENGINE_BLIND_RULES sits here.
 */
export const DEFAULT_PAGE_TIMEOUT_MS = 30_000

/** WCAG 2.2 AA and everything it builds on. Best-practice rules stay off. */
export const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

/** Which engine produced a result. Both shape their output identically. */
export type AuditEngine = 'jsdom' | 'browser'

export interface BlindRule {
  /** Why this engine cannot decide the rule. Shown to the user. */
  detail: string
  /**
   * True when axe-core calling the rule *inapplicable* proves nothing either,
   * because finding the candidate elements is itself layout- or media-
   * dependent.
   *
   * When false, an inapplicable verdict is DOM-determinable and trustworthy,
   * so the rule is left out of the report rather than adding noise.
   */
  applicabilityUnreliable: boolean
}

export type IncompleteReason = 'needs-review' | 'engine-limitation'

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
   * all, so a browser run is needed to get a verdict.
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
  engine: AuditEngine
  /** Rules that matched elements and failed. */
  violations: Finding[]
  /** No verdict reached: either a human must decide, or this engine is blind. */
  incomplete: IncompleteFinding[]
  /**
   * Rules that matched elements and were met. Never contains a rule this engine
   * is blind to, so a pass here always means the rule was evaluated.
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
  /**
   * Violations a baseline accounts for, moved out of `violations` after the
   * run. Never set by a runner: an engine has no opinion about what a project
   * has decided to live with.
   *
   * These are still violations. They are kept apart so they can be reported
   * without failing the build, and they never join `passes` — a barrier
   * somebody agreed to defer is not a criterion that was met.
   */
  accepted?: Finding[]
}

/**
 * The URL a page is audited under, shared by every runner so their reports name
 * the same page. Without a base URL that is the file it came off disk as.
 */
export function pageUrl(page: CollectedPage, baseUrl?: string): string {
  if (!baseUrl) return pathToFileURL(page.absolutePath).href
  return new URL(page.relativePath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href
}

/**
 * The elements a finding points at, as selector and markup.
 *
 * A rule can fail with no node attached — a document-level rule. It still has
 * an identity, so it gets one empty element: the baseline writer, the baseline
 * matcher, the issues view and SARIF all have to agree on what that identity
 * is, and they only do because they all come through here.
 */
export function findingElements(finding: Finding): Array<{ selector: string; html: string }> {
  if (finding.nodes.length === 0) return [{ selector: '', html: '' }]
  return finding.nodes.map((node) => ({ selector: node.target.join(' '), html: node.html }))
}

/** Every rule this page reached any verdict on, in one list. */
export function ruleOutcomes(audit: PageAudit): RuleOutcome[] {
  return [
    ...audit.violations,
    ...(audit.accepted ?? []),
    ...audit.incomplete,
    ...audit.passes,
    ...audit.inapplicable,
  ]
}

export function runOptions(
  tags: readonly string[],
  options: { skipBlindRules?: boolean } = {},
): RunOptions {
  return {
    runOnly: { type: 'tag', values: [...tags] },
    // Full node detail only where it is actually shown to the user.
    resultTypes: ['violations', 'incomplete'],
    // axe-core preloads stylesheets and media metadata for a handful of rules.
    // In jsdom nothing is ever fetched, so each of those rules burns its full
    // 10s timeout; a real 300-node page took 10.4s with preload on and 654ms
    // with it off, for identical findings.
    preload: false,
    ...(options.skipBlindRules ? { rules: disabledBlindRules() } : {}),
  }
}

/**
 * The rules this engine cannot decide, switched off rather than run.
 *
 * Normally they are run and their verdict discarded: axe-core computes colour
 * contrast against a stylesheet jsdom never fetched, and `shapeResults` throws
 * the answer away as untrustworthy. The work is wasted either way, and it is
 * not a small amount — measured at 14-19% of a page, since colour contrast is
 * the most expensive rule axe-core has.
 *
 * What is lost is the element list. A rule that runs reports *which* elements
 * it could not decide, and those are the elements a person has to check by
 * hand; a rule that never runs cannot name them. That is the whole trade, and
 * it is why this is behind a flag rather than the default.
 *
 * What does not change is the verdict. `shapeResults` already has a pass for
 * rules axe-core skipped entirely — the preload-dependent ones arrive that way
 * — and files them as unevaluated with the same reason. A criterion this run
 * could not reach still reads as unreached.
 */
function disabledBlindRules(): NonNullable<RunOptions['rules']> {
  const rules: NonNullable<RunOptions['rules']> = {}
  for (const ruleId of Object.keys(ENGINE_BLIND_RULES)) rules[ruleId] = { enabled: false }
  return rules
}

export interface ShapeResultOptions {
  relativePath: string
  absolutePath: string
  url: string
  engine: AuditEngine
  durationMs: number
  /** Rules this engine cannot decide. Empty for an engine that can see layout. */
  blind: Map<string, BlindRule>
}

/**
 * Turn raw axe-core output into a PageAudit, shared by both engines so their
 * reports are directly comparable.
 *
 * The `blind` map is what differs: jsdom passes the rules it cannot evaluate,
 * a real browser passes an empty map and keeps every verdict axe-core reached.
 */
export function shapeResults(results: AxeResults, options: ShapeResultOptions): PageAudit {
  const { blind } = options
  const violations: Finding[] = []
  const incomplete: IncompleteFinding[] = []
  const passes: RuleOutcome[] = []
  const inapplicable: RuleOutcome[] = []

  // axe-core reports a rule in more than one array when it fails on some
  // elements and passes on others: colour contrast on a page with one bad
  // paragraph comes back in both `violations` and `passes`. Recording both
  // would break the one-bucket rule and, worse, count a rule that failed
  // towards the passes, which are the only bucket meant to be evidence. The
  // worst outcome for a rule wins, in the order these loops run.
  const claimed = new Set<string>()

  // A blind rule's verdict is discarded whichever bucket axe-core put it in: a
  // violation derived from a 0x0 box is as untrustworthy as a pass. Its nodes
  // are kept, since they are still the elements a human needs to look at.
  for (const result of results.violations) {
    if (claimed.has(result.id)) continue
    claimed.add(result.id)
    const rule = blind.get(result.id)
    if (rule) incomplete.push(toIncomplete(result, 'engine-limitation', rule.detail))
    else violations.push(toFinding(result))
  }

  for (const result of results.incomplete) {
    if (claimed.has(result.id)) continue
    claimed.add(result.id)
    const rule = blind.get(result.id)
    incomplete.push(
      rule
        ? toIncomplete(result, 'engine-limitation', rule.detail)
        : toIncomplete(result, 'needs-review', result.description),
    )
  }

  for (const result of results.passes) {
    if (claimed.has(result.id)) continue
    claimed.add(result.id)
    const rule = blind.get(result.id)
    if (rule) incomplete.push(toIncomplete(result, 'engine-limitation', rule.detail))
    else passes.push(toOutcome(result))
  }

  // An inapplicable verdict is only worth recording when the rule's matcher
  // could do its job. Where it could not, filing it as "nothing to check" would
  // hide the finding.
  for (const result of results.inapplicable) {
    if (claimed.has(result.id)) continue
    claimed.add(result.id)
    const rule = blind.get(result.id)
    if (rule?.applicabilityUnreliable) {
      incomplete.push(toIncomplete(result, 'engine-limitation', rule.detail))
    } else {
      inapplicable.push(toOutcome(result))
    }
  }

  // Rules axe-core skipped entirely, e.g. the preload-dependent ones. Silence
  // would read as coverage this run never had.
  for (const [ruleId, rule] of blind) {
    if (claimed.has(ruleId)) continue
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
    relativePath: options.relativePath,
    absolutePath: options.absolutePath,
    url: options.url,
    engine: options.engine,
    violations,
    incomplete: incomplete.sort(byRuleId),
    passes: passes.sort(byRuleId),
    inapplicable: inapplicable.sort(byRuleId),
    durationMs: options.durationMs,
  }
}

/** A page that could not be audited: no verdicts, and the reason recorded. */
export function failedPage(options: Omit<ShapeResultOptions, 'blind'>, error: string): PageAudit {
  return {
    relativePath: options.relativePath,
    absolutePath: options.absolutePath,
    url: options.url,
    engine: options.engine,
    violations: [],
    incomplete: [],
    passes: [],
    inapplicable: [],
    durationMs: options.durationMs,
    error,
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
export function successCriteria(tags: readonly string[]): string[] {
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
export function enClauses(tags: readonly string[]): string[] {
  const clauses = new Set<string>()
  for (const tag of tags) {
    const match = /^EN-(\d+(?:\.\d+)+)$/.exec(tag)
    if (match?.[1]) clauses.add(match[1])
  }
  return [...clauses].sort()
}
