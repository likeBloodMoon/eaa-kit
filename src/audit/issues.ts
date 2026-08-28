import { elementFingerprint } from './fingerprint.ts'
import { IMPACT_LEVELS, type ImpactLevel } from './impact.ts'
import type { PageAudit } from './result.ts'

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

      // A rule can fail with no node attached — a document-level rule. It still
      // has an identity, and the empty fingerprint is the one the baseline
      // writer records for exactly this case, so the two agree.
      const nodes =
        finding.nodes.length > 0
          ? finding.nodes.map((node) => ({ selector: node.target.join(' '), html: node.html }))
          : [{ selector: '', html: '' }]

      for (const node of nodes) {
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

/** Widest reach first, then by selector so two runs agree. */
function byReachThenSelector(a: IssueElement, b: IssueElement): number {
  return b.pages.length - a.pages.length || a.selector.localeCompare(b.selector)
}

/**
 * Worst first, then widest reach, then by rule id.
 *
 * An unclassified impact sorts with the most severe, on the same reasoning as
 * `--fail-on`: not knowing how bad a barrier is is not evidence that it is mild.
 */
function bySeverityThenReach(a: Issue, b: Issue): number {
  const rank = (issue: Issue): number =>
    issue.impact === null ? IMPACT_LEVELS.length : IMPACT_LEVELS.indexOf(issue.impact)
  return rank(b) - rank(a) || b.pages.length - a.pages.length || a.ruleId.localeCompare(b.ruleId)
}
