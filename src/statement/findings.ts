import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { IMPACT_LEVELS, type ImpactLevel } from '../audit/impact.ts'
import * as s from '../schema.ts'
import { StatementError } from './error.ts'

/**
 * JSON report schema version this reader accepts. It mirrors SCHEMA_VERSION in
 * audit/report/json.ts, which is not imported here because that module pulls in
 * axe-core and the statement path deliberately does not. A test asserts the two
 * stay in step.
 */
export const SUPPORTED_REPORT_SCHEMA = 1

/**
 * Only the fields the statement reads. Everything else in the report — node
 * markup, selectors, passes, inapplicable — is audit detail with no place in a
 * legal document, and unknown keys are dropped rather than being carried along.
 */
const reportSchema = s.object({
  schemaVersion: s.number(),
  // The JSON contract calls this ISO 8601, and the statement formats it into a
  // date somebody publishes. Anything else reaches Intl as an invalid time and
  // throws a RangeError out of a document generator, which is neither a useful
  // error nor a survivable one.
  generatedAt: s.isoDateTime(),
  summary: s.object({
    pages: s.number(),
    needsReview: s.number(),
    notEvaluated: s.number(),
  }),
  rules: s.record(
    s.object({
      help: s.string(),
      successCriteria: s.withDefault(s.array(s.string()), () => []),
      en301549: s.withDefault(s.array(s.string()), () => []),
    }),
  ),
  pages: s.array(
    s.object({
      path: s.string(),
      violations: s.withDefault(
        s.array(
          s.object({
            ruleId: s.string(),
            impact: s.withDefault(s.nullable(s.string()), () => null),
          }),
        ),
        () => [],
      ),
    }),
  ),
})

/** One rule that failed, folded across every page it failed on. */
export interface AuditFinding {
  ruleId: string
  /**
   * axe-core's help text. English whatever the statement's language, which is
   * why the templates label it as coming from the tool rather than presenting
   * it as the provider's own description.
   */
  help: string
  /** Least-to-most severe, or null when axe-core did not classify it. */
  impact: ImpactLevel | null
  /** WCAG success criteria, e.g. ['1.1.1']. */
  successCriteria: string[]
  /** EN 301 549 clauses, e.g. ['9.1.1.1']. */
  en301549: string[]
  /** Pages it failed on, relative to the audited directory, sorted. */
  pages: string[]
}

/** What an audit contributes to a statement. */
export interface AuditSummary {
  /** Violations, most severe first. */
  findings: AuditFinding[]
  /** Pages the run covered. */
  pages: number
  /** Rules that need a human decision. Not barriers, and not evidence either. */
  needsReview: number
  /** Rules the engine could not evaluate. Never reported as passing. */
  notEvaluated: number
  /** When the audit ran. ISO 8601. */
  generatedAt: string
}

/**
 * Turn a parsed `eaa-kit audit --format json` document into statement input.
 *
 * Only violations become barriers. A rule needing manual review has not been
 * found inaccessible, and a rule the engine could not evaluate has not been
 * found anything at all; listing either as non-accessible content would be a
 * claim the audit never made. Both are carried as counts instead, so the
 * statement can say how much the automated run left open.
 */
export function summariseAuditReport(value: unknown, source = 'audit report'): AuditSummary {
  const result = s.safeParse(reportSchema, value)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`)
      .slice(0, 5)
    throw new StatementError(`${source} is not an eaa-kit JSON report (${issues.join('; ')})`)
  }

  const report = result.data
  if (report.schemaVersion !== SUPPORTED_REPORT_SCHEMA) {
    throw new StatementError(
      `${source} has schemaVersion ${report.schemaVersion}; this version of eaa-kit reads ${SUPPORTED_REPORT_SCHEMA}`,
    )
  }

  const byRule = new Map<string, AuditFinding>()

  // A Map rather than the parsed object: `rules['constructor']` reaches
  // Object.prototype and comes back truthy, which walks straight past the
  // missing-rule check below and puts a barrier with no description into
  // somebody's statement. A rule id is data from a file, so it gets a lookup
  // that only ever sees the keys the file actually had.
  const rules = new Map(Object.entries(report.rules))

  for (const page of report.pages) {
    for (const violation of page.violations) {
      const rule = rules.get(violation.ruleId)
      // A report whose rule index is missing an id it references is malformed
      // rather than empty; skipping the entry loses a barrier, so it is named.
      if (!rule) {
        throw new StatementError(
          `${source} references rule ${violation.ruleId}, which is not in its rule index`,
        )
      }

      const existing = byRule.get(violation.ruleId)
      if (existing) {
        if (!existing.pages.includes(page.path)) existing.pages.push(page.path)
        continue
      }

      byRule.set(violation.ruleId, {
        ruleId: violation.ruleId,
        help: rule.help,
        impact: toImpact(violation.impact),
        successCriteria: rule.successCriteria,
        en301549: rule.en301549,
        pages: [page.path],
      })
    }
  }

  const findings = [...byRule.values()]
  for (const finding of findings) finding.pages.sort()
  findings.sort(bySeverityThenRule)

  return {
    findings,
    pages: report.summary.pages,
    needsReview: report.summary.needsReview,
    notEvaluated: report.summary.notEvaluated,
    generatedAt: report.generatedAt,
  }
}

/** Read and summarise a report written by `eaa-kit audit --format json`. */
export async function readAuditReport(file: string, cwd = process.cwd()): Promise<AuditSummary> {
  const target = path.resolve(cwd, file)
  let raw: string
  try {
    raw = await readFile(target, 'utf8')
  } catch {
    throw new StatementError(`Could not read the audit report at ${file}`)
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    throw new StatementError(
      `${path.basename(target)} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  return summariseAuditReport(value, path.basename(target))
}

function toImpact(value: string | null): ImpactLevel | null {
  return (IMPACT_LEVELS as readonly string[]).includes(value ?? '') ? (value as ImpactLevel) : null
}

/**
 * Most severe first, then by rule id so two runs of the same build order the
 * list identically. An unclassified impact sorts with the most severe, on the
 * same reasoning as `--fail-on`: a missing impact is a gap in what we know, not
 * evidence that the barrier is harmless.
 */
function bySeverityThenRule(a: AuditFinding, b: AuditFinding): number {
  const rank = (finding: AuditFinding): number =>
    finding.impact === null ? IMPACT_LEVELS.length : IMPACT_LEVELS.indexOf(finding.impact)
  const difference = rank(b) - rank(a)
  return difference === 0 ? a.ruleId.localeCompare(b.ruleId) : difference
}
