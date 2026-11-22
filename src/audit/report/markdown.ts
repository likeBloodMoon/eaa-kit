import { count } from '../../text.ts'
import { TOOL_VERSION } from '../../version.ts'
import { missedParts, type RunCompleteness } from '../completeness.ts'
import { type ImpactLevel, impactLabel, meetsThreshold } from '../impact.ts'
import { blindRules, groupIssues, type Issue } from '../issues.ts'
import type { PageAudit } from '../runners/jsdom.ts'
import { buildSummary } from './json.ts'

/**
 * A Markdown summary of a run, for a CI job summary or a pull request comment.
 *
 * The other reports describe the site. This one describes the change: it is
 * read by somebody looking at one push, who wants to know whether that push
 * added a barrier, and who will not scroll. So it leads with the verdict, lists
 * only what fails the run, and with a baseline it separates what this change
 * introduced from what the project had already accepted.
 *
 * It keeps the refusals the other reports make. Rules the engine could not
 * evaluate and pages the run never reached are said in the summary itself, not
 * left for a reader to infer from a green tick, and nothing here is a
 * conformance claim.
 *
 * GitHub caps a comment at 65,536 characters and a job summary at 1 MiB, and a
 * site with a broken shared component can produce thousands of elements. The
 * lists are bounded, and what was cut is counted.
 */

/** Rules listed in the table before the rest are counted. */
const MAX_RULES = 25

/** Pages named per rule before the rest are counted. */
const MAX_PAGES = 3

export interface MarkdownReportOptions {
  /** What was audited: a build directory, or a crawl's entry URL. */
  directory: string
  failOn: ImpactLevel
  completeness?: RunCompleteness
  /**
   * What the baseline said about this run, when one was used. `stale` is the
   * entries whose element was not found on a page this run audited: fixed, or
   * at least gone.
   */
  baseline?: { stale: number; expired: number }
}

export function buildMarkdownReport(
  audits: readonly PageAudit[],
  options: MarkdownReportOptions,
): string {
  const totals = buildSummary(audits, options.failOn)
  const issues = groupIssues(audits)
  const failing = issues.filter((issue) => fails(issue, options.failOn))
  const below = issues.filter((issue) => !fails(issue, options.failOn))
  const blind = blindRules(audits).length
  const review = needsReviewRules(audits)

  const lines: string[] = ['## Accessibility audit', '', verdict(totals, failing, options), '']

  lines.push('| | |', '| --- | ---: |')
  lines.push(`| ${newLabel(options)} at or above ${options.failOn} | ${totals.failing} |`)
  if (below.length > 0) {
    lines.push(`| Violations below ${options.failOn}, not failing | ${belowCount(below, audits)} |`)
  }
  if (options.baseline) {
    lines.push(`| Elements the baseline accepts | ${totals.accepted} |`)
    if (options.baseline.stale > 0) {
      lines.push(`| Baseline entries now fixed or gone | ${options.baseline.stale} |`)
    }
    if (options.baseline.expired > 0) {
      lines.push(`| Baseline entries expired | ${options.baseline.expired} |`)
    }
  }
  lines.push(`| Rules that need a person to decide | ${review} |`)
  lines.push(`| Rules this engine could not evaluate | ${blind} |`)
  lines.push(`| Pages audited | ${totals.pages - totals.pagesNotAudited} |`)
  if (totals.pagesNotAudited > 0) {
    lines.push(`| Pages that could not be audited | ${totals.pagesNotAudited} |`)
  }
  lines.push('')

  if (failing.length > 0) {
    lines.push(`### ${options.baseline ? 'New barriers' : 'Barriers that fail the run'}`, '')
    lines.push(...issueTable(failing))
  }

  const unmeasured = notMeasured(options, blind, totals.pagesNotAudited)
  if (unmeasured.length > 0) {
    lines.push('### Not checked by this run', '', ...unmeasured.map((part) => `- ${part}`), '')
  }

  lines.push(
    `<sub>eaa-kit ${TOOL_VERSION} · ${escapeCell(options.directory)} · Automated testing finds ` +
      'only some barriers. This is not a conformance claim.</sub>',
    '',
  )
  return lines.join('\n')
}

/** One line a reader can stop at. */
function verdict(
  totals: ReturnType<typeof buildSummary>,
  failing: readonly Issue[],
  options: MarkdownReportOptions,
): string {
  if (totals.pagesNotAudited > 0) {
    return `**Could not finish.** ${count(totals.pagesNotAudited, 'page')} could not be audited, so this run reached no verdict.`
  }
  if (failing.length > 0) {
    const what = options.baseline ? 'new violation' : 'violation'
    return `**${count(totals.failing, what)}** at or above ${options.failOn}, across ${count(failing.length, 'rule')}.`
  }
  const prefix = options.baseline ? 'No new violations' : 'No violations'
  const completeness = options.completeness
  if (completeness && !completeness.complete) {
    return `**${prefix} found, but the whole site was not measured.** ${missedParts(completeness).join(', ')}.`
  }
  return `**${prefix} found** at or above ${options.failOn}.`
}

function newLabel(options: MarkdownReportOptions): string {
  return options.baseline ? 'New violations' : 'Violations'
}

/**
 * The failing rules, worst first, with where they are.
 *
 * Elements rather than occurrences: one broken header on forty pages is one
 * thing to fix, and the reader of a pull request is deciding what to fix.
 */
function issueTable(issues: readonly Issue[]): string[] {
  const lines = [
    '| Severity | Rule | WCAG | Elements | Pages |',
    '| --- | --- | --- | ---: | --- |',
  ]
  for (const issue of issues.slice(0, MAX_RULES)) {
    const criteria = issue.successCriteria.join(', ') || '–'
    lines.push(
      `| ${impactLabel(issue.impact)} | [\`${issue.ruleId}\`](${issue.helpUrl}) ${escapeCell(issue.help)} | ${criteria} | ${issue.elements.length} | ${pageList(issue.pages)} |`,
    )
  }
  if (issues.length > MAX_RULES) {
    lines.push(
      '',
      `${count(issues.length - MAX_RULES, 'more rule')} not listed. The HTML or JSON report has them all.`,
    )
  }
  lines.push('')
  return lines
}

function pageList(pages: readonly string[]): string {
  const named = pages.slice(0, MAX_PAGES).map((page) => `\`${escapeCode(page)}\``)
  const rest = pages.length - named.length
  return rest > 0 ? `${named.join(', ')} and ${rest} more` : named.join(', ')
}

/**
 * What the run never looked at, in the summary rather than behind a link: a
 * green summary over half a site is the result most worth qualifying.
 */
function notMeasured(options: MarkdownReportOptions, blind: number, unaudited: number): string[] {
  const parts: string[] = []
  const completeness = options.completeness
  if (completeness && !completeness.complete) parts.push(...missedParts(completeness))
  if (unaudited > 0) parts.push(`${count(unaudited, 'page')} could not be audited`)
  if (blind > 0) {
    parts.push(
      `${count(blind, 'rule')} this engine could not evaluate, such as colour contrast without a browser. They are not counted as passes.`,
    )
  }
  return parts
}

/** The same test `--fail-on` applies, unclassified included. */
function fails(issue: Issue, failOn: ImpactLevel): boolean {
  return meetsThreshold(issue.impact, failOn)
}

/** Violations below the threshold, counted the way `summary.violations` counts them. */
function belowCount(below: readonly Issue[], audits: readonly PageAudit[]): number {
  const rules = new Set(below.map((issue) => issue.ruleId))
  let total = 0
  for (const audit of audits) {
    for (const finding of audit.violations) if (rules.has(finding.ruleId)) total += 1
  }
  return total
}

/** Distinct rules that want a person, not one per page. */
function needsReviewRules(audits: readonly PageAudit[]): number {
  const rules = new Set<string>()
  for (const audit of audits) {
    for (const finding of audit.incomplete) {
      if (finding.reason === 'needs-review') rules.add(finding.ruleId)
    }
  }
  return rules.size
}

/** Text in a table cell: a pipe or a newline would end the cell or the row. */
function escapeCell(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\\|`*_[\]<>]/g, (char) => `\\${char}`)
    .trim()
}

/** Text inside backticks: a backtick would close the span early. */
function escapeCode(text: string): string {
  return text.replace(/`/g, "'").replace(/\|/g, '\\|')
}
