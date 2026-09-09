import { access } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_REVIEW_FILE } from '../audit/review.ts'
import { count } from '../text.ts'
import { emitDocument, fail, note } from './command.ts'

/**
 * `eaa-kit checklist`.
 *
 * Writes the two halves of a manual review: the record the tool reads back, and
 * the worksheet a person works through. Both are generated from one list of
 * criteria, so they cannot disagree about what the review covers.
 *
 * Re-running is safe, and is the point: the record keeps every answer already
 * in it and only fills in what is missing, so a review done over three sittings
 * survives a criterion list that grew between them.
 */

export interface ChecklistCommandOptions {
  /** Where the record lives. Read if it is there, written back either way. */
  record?: string
  /** Where the worksheet goes. Stdout when absent. */
  output?: string
  /** Recorded on the file as a whole, for whoever reads it later. */
  reviewedBy?: string
  /** Where relative paths are resolved from. Defaults to the process's. */
  cwd?: string
}

export interface ChecklistCommandResult {
  /** 0 written, 2 an existing record could not be read. */
  exitCode: number
}

export async function runChecklistCommand(
  options: ChecklistCommandOptions = {},
): Promise<ChecklistCommandResult> {
  const cwd = options.cwd ?? process.cwd()
  const recordPath = options.record ?? DEFAULT_REVIEW_FILE

  const { WCAG22_AA_CRITERIA } = await import('../audit/coverage.ts')
  const { answeredCount, blankReview, readReview, ReviewError, writeReview } = await import(
    '../audit/review.ts'
  )

  // A record that exists and cannot be read is exit 2, never a fresh start:
  // overwriting somebody's review because the file had a typo in it would
  // destroy the only copy of work no tool can redo.
  let existing: Awaited<ReturnType<typeof readReview>> | undefined
  try {
    existing = await readReview(recordPath, cwd)
  } catch (cause) {
    if (!(cause instanceof ReviewError)) throw cause
    if (await exists(path.resolve(cwd, recordPath))) {
      fail(cause.message)
      return { exitCode: 2 }
    }
  }

  const record = blankReview(WCAG22_AA_CRITERIA, existing)
  if (options.reviewedBy !== undefined) record.reviewedBy = options.reviewedBy

  await writeReview(recordPath, record, cwd)
  note(
    existing === undefined
      ? `Review record written to ${recordPath}`
      : `Review record updated at ${recordPath}: ${count(answeredCount(record), 'criterion')} already answered`,
  )

  const { buildWorksheet } = await import('../audit/worksheet.ts')
  await emitDocument(buildWorksheet({ recordPath, review: record }), options.output, cwd)
  if (options.output !== undefined) note(`Worksheet written to ${options.output}`)

  note('Answers go in the record; the worksheet is generated and never read back.')
  return { exitCode: 0 }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}
