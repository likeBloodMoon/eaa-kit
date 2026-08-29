import { elementFingerprint } from './fingerprint.ts'
import { type ImpactLevel, impactRank } from './impact.ts'
import { findingElements, type IncompleteFinding, type PageAudit } from './result.ts'

/**
 * Violations grouped by the element that causes them, across the whole site.
 *
 * A page-by-page report is the truth but it is not the work. On a site built
 * from components, one broken header reappears on every page that renders it: a
 * seven-page site with a missing `alt` in its header reports seven violations,
 * and nothing in that report says they are one line in one file. Somebody
 * reading it has to notice the markup repeating and infer the component.
 *
 * Grouping by the element's fingerprint says it outright. The same rule failing
 * on byte-identical markup across several pages is one defect with reach, and
 * the fix is one edit — which is both the useful thing to know and the honest
 * way to count it.
 */

/** One distinct failing element, and everywhere it appears. */
export interface IssueElement {
  /** Identity of the element: rule, selector and markup. Never the path. */
  fingerprint: string
  selector: string
  html: string
  /** Pages it was found on, sorted. */
  pages: string[]
}

/** One rule's failures across the site, folded by element. */
export interface Issue {
  ruleId: string
  help: string
  /** Least-to-most severe, or null when axe-core did not classify it. */
  impact: ImpactLevel | null
  successCriteria: string[]
  enClauses: string[]
  /** Helps somebody look the rule up. */
  helpUrl: string
  /** Distinct elements that fail this rule, most widespread first. */
  elements: IssueElement[]
  /** Every page this rule failed on, sorted. */
  pages: string[]
  /** Failing elements counted once per page, as the page report counts them. */
  occurrences: number
}

/**
 * An element on this many pages is almost certainly a shared component rather
 * than markup somebody repeated by hand. Two is a coincidence; three is a
 * layout, a header, a footer or a card.
 */
export const SHARED_COMPONENT_THRESHOLD = 3

/** Whether this element looks like one component rendered on many pages. */
export function isShared(element: IssueElement): boolean {
  return element.pages.length >= SHARED_COMPONENT_THRESHOLD
}

/**
 * Fold a run's violations into one entry per rule, and one per element within it.
 *
 * Accepted violations are not included: a baseline moves them out of what fails
 * the build, and this is a view of what fails.
 */
export function groupIssues(audits: readonly PageAudit[]): Issue[] {
  const byRule = new Map<string, Issue>()

  for (const audit of audits) {
    for (const finding of audit.violations) {
      let issue = byRule.get(finding.ruleId)
      if (issue === undefined) {
        issue = {
          ruleId: finding.ruleId,
          help: finding.help,
          impact: finding.impact ?? null,
          successCriteria: finding.successCriteria,
          enClauses: finding.enClauses,
          helpUrl: finding.helpUrl,
          elements: [],
          pages: [],
          occurrences: 0,
        }
        byRule.set(finding.ruleId, issue)
      }

      if (!issue.pages.includes(audit.relativePath)) issue.pages.push(audit.relativePath)

      for (const node of findingElements(finding)) {
        issue.occurrences += 1
        const fingerprint = elementFingerprint(finding.ruleId, node.selector, node.html)
        const existing = issue.elements.find((element) => element.fingerprint === fingerprint)
        if (existing) {
          if (!existing.pages.includes(audit.relativePath)) existing.pages.push(audit.relativePath)
          continue
        }
        issue.elements.push({
          fingerprint,
          selector: node.selector,
          html: node.html,
          pages: [audit.relativePath],
        })
      }
    }
  }

  const issues = [...byRule.values()]
  for (const issue of issues) {
    issue.pages.sort()
    for (const element of issue.elements) element.pages.sort()
    issue.elements.sort(byReachThenSelector)
  }
  issues.sort(bySeverityThenReach)
  return issues
}

/** One rule this engine reached no verdict on, and how far it reached. */
export interface BlindRuleGroup {
  ruleId: string
  /** Pages the rule was left unevaluated on. */
  pages: number
  /** One of the findings, for the detail and the criteria it maps to. */
  finding: IncompleteFinding
}

/**
 * Unevaluated rules folded across the site, sorted by rule id.
 *
 * Both reports list these once at the end rather than under every page: on a
 * large site the same handful recurs on each one, and a wall of "not evaluated"
 * would bury the findings that are real.
 */
export function blindRules(audits: readonly PageAudit[]): BlindRuleGroup[] {
  const byRule = new Map<string, BlindRuleGroup>()
  for (const audit of audits) {
    for (const finding of audit.incomplete) {
      if (finding.reason !== 'engine-limitation') continue
      const entry = byRule.get(finding.ruleId)
      if (entry) entry.pages += 1
      else byRule.set(finding.ruleId, { ruleId: finding.ruleId, pages: 1, finding })
    }
  }
  return [...byRule.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId))
}

/**
 * What one page's result actually rests on, as phrases both reports print.
 *
 * The counts stay separate on purpose. Only `passed` is evidence that a
 * criterion was met here; `not applicable` means the rule found nothing to
 * check, and adding the two together would turn an empty page into a
 * near-perfect score.
 */
export function coverageParts(audit: PageAudit): string[] {
  const blind = audit.incomplete.filter((finding) => finding.reason === 'engine-limitation').length
  const review = audit.incomplete.length - blind
  const parts = [`${audit.passes.length} passed`, `${audit.inapplicable.length} not applicable`]
  if (review > 0) parts.push(`${review} to review`)
  if (blind > 0) parts.push(`${blind} not evaluated`)
  return parts
}

/** Widest reach first, then by selector so two runs agree. */
function byReachThenSelector(a: IssueElement, b: IssueElement): number {
  return b.pages.length - a.pages.length || a.selector.localeCompare(b.selector)
}

/** Worst first, then widest reach, then by rule id. */
function bySeverityThenReach(a: Issue, b: Issue): number {
  return (
    impactRank(a.impact) - impactRank(b.impact) ||
    b.pages.length - a.pages.length ||
    a.ruleId.localeCompare(b.ruleId)
  )
}
