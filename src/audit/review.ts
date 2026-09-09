import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as s from '../schema.ts'
import { isoDate } from '../text.ts'

/**
 * What a person checked, recorded where the tool can read it back.
 *
 * Of the 55 WCAG 2.2 A and AA success criteria, 34 have no automated rule at
 * all, and every report this tool writes says so. Saying so was where it
 * stopped: there was nowhere to put the answer, so a site nobody had ever
 * reviewed and a site audited by hand last week produced identical coverage.
 * The gap the tool is most careful to name was the one thing it could not
 * record progress against.
 *
 * This file is that record. It is deliberately not evidence of anything: it
 * holds what somebody said they checked, when, and what they concluded — the
 * same standing as the claims in an accessibility statement, which this tool
 * has always been willing to write down and has never pretended to verify.
 *
 * What it is not allowed to do is the important half:
 *
 * - It never overturns the engine. A criterion the engine reached a verdict on
 *   keeps that verdict; a person recording "met" against a rule that is
 *   currently failing changes nothing but what is printed beside it.
 * - It never counts an entry nobody dated when the caller asked for a maximum
 *   age. An undated review cannot be shown to still hold.
 * - It never counts `unreviewed`. Generating the worksheet is not doing the
 *   check, and a record full of blanks means the work has not been done.
 */

/**
 * Bumped only when a field is removed, renamed, or changes meaning — the same
 * rule the report and baseline versions follow.
 */
export const REVIEW_SCHEMA_VERSION = 1

/** Default filename, used by the CLI when no path is given. */
export const DEFAULT_REVIEW_FILE = 'eaa-review.json'

/**
 * What a person concluded about one criterion.
 *
 * `not-applicable` is kept apart from `met` for the reason `inapplicable` is
 * kept apart from `passes` everywhere else in this tool: a criterion with
 * nothing on the site to which it applies has not been met, it has been ruled
 * out, and folding the two together would let an empty site look conformant.
 */
export const REVIEW_RESULTS = ['met', 'not-met', 'not-applicable', 'unreviewed'] as const

export type ReviewResult = (typeof REVIEW_RESULTS)[number]

const entrySchema = s.object({
  result: s.withDefault(s.enumeration(REVIEW_RESULTS), () => 'unreviewed' as ReviewResult),
  /** ISO date the check was done. Without it the entry cannot be aged. */
  reviewedOn: s.optional(s.isoDate()),
  /** Who did it, when that is not the person named on the record. */
  reviewedBy: s.optional(s.string()),
  /** What was checked and what was found. Free text, for whoever reads it. */
  note: s.optional(s.string()),
})

const reviewSchema = s.object({
  schemaVersion: s.number(),
  /** Who carried out the review, for the record as a whole. */
  reviewedBy: s.optional(s.string()),
  /** Keyed by success criterion number, e.g. '1.2.1'. */
  criteria: s.withDefault(
    s.record(entrySchema),
    () => ({}) as Record<string, s.Infer<typeof entrySchema>>,
  ),
})

export type ReviewEntry = s.Infer<typeof entrySchema>
export type ReviewRecord = s.Infer<typeof reviewSchema>

export class ReviewError extends Error {
  override readonly name = 'ReviewError'
}

/** How a review record is applied to a run. */
export interface ReviewOptions {
  record: ReviewRecord
  /**
   * Days after which a dated entry stops counting, and an undated one never
   * counted in the first place. Undefined leaves every dated entry standing:
   * how long a manual review remains true is a judgement about a site's rate of
   * change, and the tool has no way to make it.
   */
  maxAgeDays?: number
  /** Injectable so ageing can be tested without waiting. Defaults to today. */
  today?: Date
}

/** Why an entry was read but not counted. */
export type ReviewIgnored = 'engine-reached-a-verdict' | 'stale' | 'undated'

/** One criterion's review, as the reports print it. */
export interface CriterionReview extends ReviewEntry {
  /** False when the entry is recorded but does not extend what the run reached. */
  counts: boolean
  /** Present when `counts` is false, saying which refusal applied. */
  ignored?: ReviewIgnored
}

/**
 * What the record says about one criterion, and whether it counts.
 *
 * Returns undefined when there is nothing recorded, which is the ordinary case
 * for most criteria of most sites: a missing entry and an `unreviewed` one mean
 * the same thing and are reported the same way.
 */
export function criterionReview(
  criterionNumber: string,
  options: ReviewOptions,
  /** True when the engine itself reached a pass or a violation here. */
  engineReachedVerdict: boolean,
): CriterionReview | undefined {
  const entry = options.record.criteria[criterionNumber]
  if (entry === undefined || entry.result === 'unreviewed') return undefined

  // Who did it falls back to whoever the record names: most reviews are one
  // person working through the list, and making them write their own name into
  // 55 entries would guarantee that most entries do not carry it.
  const attributed = {
    ...entry,
    ...(entry.reviewedBy === undefined && options.record.reviewedBy !== undefined
      ? { reviewedBy: options.record.reviewedBy }
      : {}),
  }

  const ignored = ignoredReason(entry, options, engineReachedVerdict)
  return ignored === undefined
    ? { ...attributed, counts: true }
    : { ...attributed, counts: false, ignored }
}

function ignoredReason(
  entry: ReviewEntry,
  options: ReviewOptions,
  engineReachedVerdict: boolean,
): ReviewIgnored | undefined {
  // The engine's verdict stands. A person's note beside it is still printed —
  // somebody checking by hand what a rule already decided is doing useful work
  // — but it does not extend the coverage of the run, and it certainly does not
  // move a failing criterion to met.
  if (engineReachedVerdict) return 'engine-reached-a-verdict'

  if (options.maxAgeDays === undefined) return undefined
  if (entry.reviewedOn === undefined) return 'undated'
  return olderThan(entry.reviewedOn, options.maxAgeDays, options.today ?? new Date())
    ? 'stale'
    : undefined
}

/** Whole days between an ISO date and today, without pulling in a date library. */
function olderThan(reviewedOn: string, maxAgeDays: number, today: Date): boolean {
  const then = Date.parse(`${reviewedOn}T00:00:00Z`)
  if (Number.isNaN(then)) return true
  const now = Date.parse(`${isoDate(today)}T00:00:00Z`)
  return (now - then) / 86_400_000 > maxAgeDays
}

/** A record with an entry for every criterion, keeping any answers already given. */
export function blankReview(
  criteria: readonly { number: string }[],
  existing?: ReviewRecord,
): ReviewRecord {
  const entries: Record<string, ReviewEntry> = {}
  for (const criterion of criteria) {
    entries[criterion.number] = existing?.criteria[criterion.number] ?? { result: 'unreviewed' }
  }

  // Anything recorded against a criterion this build of the tool does not list
  // is kept rather than dropped: it is somebody's work, and a criterion number
  // it does not recognise is more likely a newer WCAG than a mistake.
  for (const [number, entry] of Object.entries(existing?.criteria ?? {})) {
    entries[number] ??= entry
  }

  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    ...(existing?.reviewedBy ? { reviewedBy: existing.reviewedBy } : {}),
    criteria: sortByCriterion(entries),
  }
}

/** How many criteria the record has a usable answer for, before any run is considered. */
export function answeredCount(record: ReviewRecord): number {
  return Object.values(record.criteria).filter((entry) => entry.result !== 'unreviewed').length
}

/** Numerically by section, so 1.4.10 sorts after 1.4.5 rather than before it. */
function sortByCriterion(entries: Record<string, ReviewEntry>): Record<string, ReviewEntry> {
  return Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => compareCriteria(a, b)),
  ) as Record<string, ReviewEntry>
}

export function compareCriteria(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function serialiseReview(record: ReviewRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`
}

export async function readReview(file: string, cwd = process.cwd()): Promise<ReviewRecord> {
  const target = path.resolve(cwd, file)
  let raw: string
  try {
    raw = await readFile(target, 'utf8')
  } catch {
    throw new ReviewError(
      `Could not read the review record at ${file}. Create one with: eaa-kit checklist`,
    )
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    throw new ReviewError(
      `${path.basename(target)} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  const result = s.safeParse(reviewSchema, value)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`)
      .slice(0, 5)
    throw new ReviewError(
      `${path.basename(target)} is not an eaa-kit review record (${issues.join('; ')})`,
    )
  }
  if (result.data.schemaVersion !== REVIEW_SCHEMA_VERSION) {
    throw new ReviewError(
      `${path.basename(target)} has schemaVersion ${result.data.schemaVersion}; this version of eaa-kit reads ${REVIEW_SCHEMA_VERSION}.`,
    )
  }

  return result.data
}

export async function writeReview(
  file: string,
  record: ReviewRecord,
  cwd = process.cwd(),
): Promise<string> {
  const target = path.resolve(cwd, file)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, serialiseReview(record), 'utf8')
  return target
}
