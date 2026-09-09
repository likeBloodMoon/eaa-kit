import { rulesByCriterion, type SuccessCriterion, WCAG22_AA_CRITERIA } from './coverage.ts'
import { manualCheckFor, understandingUrl } from './manual.ts'
import { DEFAULT_TAGS } from './result.ts'
import type { ReviewRecord } from './review.ts'

/**
 * The manual review as a document somebody can actually work through.
 *
 * The record next to it is JSON because the tool has to read it back. This is
 * the other half: Markdown, ordered by criterion, with the check to do and a
 * link to what the criterion requires — the thing you print, or open beside the
 * site, and tick off.
 *
 * It is generated and never parsed. Answers go in the JSON record, which is the
 * file the audit reads; a worksheet somebody has ticked in the Markdown is a
 * worksheet the tool will not see, and it says so at the top rather than
 * quietly ignoring the work.
 */

export interface WorksheetOptions {
  /** Answers already recorded, shown beside each criterion. */
  review?: ReviewRecord
  /** Path the record lives at, named in the instructions. */
  recordPath: string
  /** Rule tags the audit runs under, deciding which criteria have rules at all. */
  tags?: readonly string[]
}

export function buildWorksheet(options: WorksheetOptions): string {
  const rules = rulesByCriterion(options.tags ?? DEFAULT_TAGS)

  const unautomatable = WCAG22_AA_CRITERIA.filter(
    (criterion) => (rules.get(criterion.number) ?? []).length === 0,
  )

  const lines: string[] = [
    '# Manual accessibility review',
    '',
    `Of the ${WCAG22_AA_CRITERIA.length} WCAG 2.2 success criteria at Levels A and AA,`,
    `**${unautomatable.length} have no automated rule at all**: no engine, this one included, can`,
    'reach a verdict on them. They are the part of conformance a person has to do, and this is',
    'the list of them.',
    '',
    `Record what you find in \`${options.recordPath}\`, which is the file \`eaa-kit audit --review\``,
    'reads. Ticking a box below records nothing: this document is generated from the record and',
    'never read back into it.',
    '',
    'For each criterion, set `result` to one of:',
    '',
    '- `met` — you checked it and the site meets it.',
    '- `not-met` — you checked it and it does not. Say what is wrong in `note`.',
    '- `not-applicable` — there is nothing on this site the criterion applies to. Not the same',
    '  as `met`, and never counted as though it were.',
    '- `unreviewed` — nobody has looked yet. What every entry starts as.',
    '',
    'Set `reviewedOn` to the day you checked it. An entry with no date cannot be shown to still',
    'hold, and an audit run with `--review-max-age` will not count it.',
    '',
  ]

  lines.push(
    '## Criteria no automated rule can reach',
    '',
    'These are the review. Nothing in any eaa-kit report says anything about them.',
    '',
  )
  for (const criterion of unautomatable) {
    lines.push(...criterionEntry(criterion, [], options.review))
  }

  lines.push(
    '## Criteria an audit can reach',
    '',
    'An audit reaches these when the rules below actually match something on the site. A run',
    'that found nothing to check has not shown the criterion is met, so they are worth a look',
    'too — and where this engine could not decide a rule, the check to do by hand is named.',
    '',
  )
  for (const criterion of WCAG22_AA_CRITERIA) {
    const forCriterion = rules.get(criterion.number) ?? []
    if (forCriterion.length === 0) continue
    lines.push(...criterionEntry(criterion, forCriterion, options.review))
  }

  lines.push(
    '---',
    '',
    'A completed review is not a compliance statement, and this tool cannot check that anything',
    'recorded here is true. It records what somebody says they checked, which is the same',
    'standing as the claims in the statement it generates.',
    '',
  )

  return lines.join('\n')
}

function criterionEntry(
  criterion: SuccessCriterion,
  rules: readonly string[],
  review: ReviewRecord | undefined,
): string[] {
  const entry = review?.criteria[criterion.number]
  const done = entry !== undefined && entry.result !== 'unreviewed'
  const lines = [
    `- [${done ? 'x' : ' '}] **${criterion.number} ${criterion.title}** (Level ${criterion.level})`,
  ]

  const url = understandingUrl(criterion.number)
  if (url !== undefined) lines.push(`      What it requires: ${url}`)

  if (rules.length > 0) {
    lines.push(`      Rules that touch it: ${rules.join(', ')}`)
    for (const rule of rules) {
      const manual = manualCheckFor(rule)
      if (manual !== undefined) lines.push(`      ${rule}: ${manual.check}`)
    }
  }

  if (entry !== undefined && entry.result !== 'unreviewed') {
    const on = entry.reviewedOn === undefined ? 'no date recorded' : `on ${entry.reviewedOn}`
    lines.push(`      Recorded: ${entry.result} (${on})`)
    if (entry.note !== undefined) lines.push(`      Note: ${entry.note}`)
  }

  lines.push('')
  return lines
}
