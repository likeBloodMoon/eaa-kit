import type { ReviewRecord } from '../audit/review.ts'
import type { EaaConfig } from '../config/define.ts'
import { count, isoDate } from '../text.ts'
import type { AuditSummary } from './findings.ts'

/**
 * Whether the statement's claim survives contact with the evidence beside it.
 *
 * The README has said since 0.1 that "a statement claiming full conformance for
 * a site that is not conformant is worse than no statement at all", and until
 * now the tool did nothing about it: `compliance.status` came out of the config
 * file, the audit report came in through `--audit`, and nothing ever put the
 * two in the same room. A run could print a document claiming full conformance
 * directly above the list of barriers that disproves it.
 *
 * This is the check that was missing. It is deliberately narrow: it does not
 * decide whether a site is accessible, and it cannot — most of WCAG is not
 * automatable and the whole tool is built around saying so. It refuses only
 * claims the evidence in hand already contradicts, and warns where a document
 * is citing evidence that no longer describes the site.
 *
 * Nothing here needs an audit report. Given none, only the dates are checked,
 * and a project that has never run one gets exactly the statement it always
 * got — the tool cannot audit what it was not shown.
 */

/** How much a problem matters. `refuses` stops the statement being written. */
export type EvidenceSeverity = 'refuses' | 'warns'

export interface EvidenceProblem {
  severity: EvidenceSeverity
  /** One sentence stating the contradiction, and one naming the fix. */
  message: string
}

export interface EvidenceInput {
  config: EaaConfig
  /** From `--audit`. Without it only the dates can be checked. */
  audit?: AuditSummary
  /** From `--review`. Read for this check alone; it does not reach the text. */
  review?: ReviewRecord
  /** Injectable so the ageing checks can be tested without waiting. */
  today?: Date
}

/**
 * How old a claim or a report may be before the document says so.
 *
 * A year, because a statement is a document about a site that changes, and one
 * dated further back than that is describing a site nobody has checked since.
 * It is a warning and never a refusal: how often a statement must be revisited
 * is a question about a legal regime and a rate of change, and this tool is in
 * no position to answer it for somebody.
 */
const STALE_DAYS = 365

export function checkStatementEvidence(input: EvidenceInput): EvidenceProblem[] {
  const today = input.today ?? new Date()
  return [...claimAgainstAudit(input), ...claimAgainstReview(input), ...dates(input, today)]
}

/** Whether any problem is bad enough to stop the document being written. */
export function refuses(problems: readonly EvidenceProblem[]): boolean {
  return problems.some((problem) => problem.severity === 'refuses')
}

/**
 * A claim of full conformance, against barriers the audit found.
 *
 * Refused rather than warned about. Every other output of this tool is a report
 * somebody reads; this one is a legal document published under their name, and
 * the failure mode is not a wrong number in a terminal but a false statement on
 * a website. The fix is in the message because it is not obvious to somebody
 * filling in a config file for the first time that `partially-compliant` is the
 * ordinary answer rather than an admission of defeat.
 */
function claimAgainstAudit(input: EvidenceInput): EvidenceProblem[] {
  const audit = input.audit
  if (audit === undefined || input.config.compliance.status !== 'compliant') return []
  if (audit.findings.length === 0) return []

  const pages = new Set(audit.findings.flatMap((finding) => finding.pages)).size
  return [
    {
      severity: 'refuses',
      message:
        `The config claims full conformance, and the audit report lists ` +
        `${count(audit.findings.length, 'barrier')} on ${count(pages, 'page')}.\n` +
        `  A statement claiming full conformance for a site that is not conformant is worse\n` +
        `  than no statement at all, so this one was not written.\n` +
        `  Either fix the barriers and audit again, or set compliance.status to\n` +
        `  "partially-compliant", which is the honest answer for most sites and the one that\n` +
        `  carries the obligation to list what is missing.`,
    },
  ]
}

/**
 * A claim of full conformance, against criteria a person recorded as not met.
 *
 * The review record is the only evidence this tool has about the 34 criteria no
 * engine can reach, and a `not-met` in it is somebody's own finding. Claiming
 * full conformance over the top of it is the same false statement as claiming
 * it over the top of a violation, so it gets the same refusal.
 */
function claimAgainstReview(input: EvidenceInput): EvidenceProblem[] {
  const review = input.review
  if (review === undefined || input.config.compliance.status !== 'compliant') return []

  const notMet = Object.entries(review.criteria)
    .filter(([, entry]) => entry.result === 'not-met')
    .map(([number]) => number)
  if (notMet.length === 0) return []

  return [
    {
      severity: 'refuses',
      message:
        `The config claims full conformance, and the review record has ` +
        `${count(notMet.length, 'criterion')} recorded as not met: ${notMet.join(', ')}.\n` +
        `  Somebody checked those and wrote down that the site does not meet them, so this\n` +
        `  statement was not written. Fix them and record the result, or set\n` +
        `  compliance.status to "partially-compliant" and describe them in\n` +
        `  compliance.knownIssues.`,
    },
  ]
}

/**
 * Whether the document's dates still describe the site.
 *
 * All warnings. A date being old is not a false claim — it is a document nobody
 * has revisited, which is a different problem with a different fix, and the
 * person publishing it is the one who knows whether the site has moved.
 */
function dates(input: EvidenceInput, today: Date): EvidenceProblem[] {
  const problems: EvidenceProblem[] = []
  const assessedOn = input.config.compliance.assessedOn
  const now = isoDate(today)

  if (assessedOn > now) {
    problems.push({
      severity: 'warns',
      message:
        `compliance.assessedOn is ${assessedOn}, which is in the future. ` +
        'A statement dated ahead of its own assessment is a typo somebody will notice.',
    })
  } else if (daysBetween(assessedOn, now) > STALE_DAYS) {
    problems.push({
      severity: 'warns',
      message:
        `compliance.assessedOn is ${assessedOn}, ${count(daysBetween(assessedOn, now), 'day')} ago. ` +
        'The statement will say so, and it describes a site nobody has assessed since.',
    })
  }

  const audit = input.audit
  if (audit === undefined) return problems

  const auditDay = audit.generatedAt.slice(0, 10)

  // The evidence postdates the claim: the document says it was assessed on one
  // day and cites a run from a later one, so whatever the audit found was not
  // part of the assessment the statement describes.
  if (auditDay > assessedOn) {
    problems.push({
      severity: 'warns',
      message:
        `The audit ran on ${auditDay}, after the ${assessedOn} this statement gives as its ` +
        'assessment date. Move compliance.assessedOn forward, or cite the report from that day.',
    })
  }

  if (daysBetween(auditDay, now) > STALE_DAYS) {
    problems.push({
      severity: 'warns',
      message:
        `The audit report is from ${auditDay}, ${count(daysBetween(auditDay, now), 'day')} ago. ` +
        'The barriers it lists are the ones the site had then.',
    })
  }

  return problems
}

/** Whole days between two ISO dates, both UTC, without a date library. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.round((end - start) / 86_400_000)
}
