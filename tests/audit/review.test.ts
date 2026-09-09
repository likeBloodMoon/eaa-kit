import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { collectPages } from '../../src/audit/collect.ts'
import { buildCoverage, reviewSummary, WCAG22_AA_CRITERIA } from '../../src/audit/coverage.ts'
import {
  answeredCount,
  blankReview,
  criterionReview,
  DEFAULT_REVIEW_FILE,
  REVIEW_SCHEMA_VERSION,
  ReviewError,
  type ReviewRecord,
  readReview,
  serialiseReview,
  writeReview,
} from '../../src/audit/review.ts'
import { type PageAudit, runJsdomAudit } from '../../src/audit/runners/jsdom.ts'

const SITE = fileURLToPath(new URL('../fixtures/site', import.meta.url))
const TODAY = new Date('2026-09-09T00:00:00Z')

const dirs: string[] = []
let audits: PageAudit[]

beforeAll(async () => {
  audits = await runJsdomAudit(await collectPages(SITE))
}, 60_000)

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-review-'))
  dirs.push(dir)
  return dir
}

function record(criteria: ReviewRecord['criteria'], reviewedBy?: string): ReviewRecord {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    ...(reviewedBy === undefined ? {} : { reviewedBy }),
    criteria,
  }
}

describe('a blank record', () => {
  it('has an entry for every criterion, all unreviewed', () => {
    const blank = blankReview(WCAG22_AA_CRITERIA)

    expect(Object.keys(blank.criteria)).toHaveLength(WCAG22_AA_CRITERIA.length)
    expect(answeredCount(blank)).toBe(0)
    expect(blank.criteria['1.1.1']).toEqual({ result: 'unreviewed' })
  })

  it('sorts criteria numerically, so 1.4.10 follows 1.4.5', () => {
    const numbers = Object.keys(blankReview(WCAG22_AA_CRITERIA).criteria)

    expect(numbers.indexOf('1.4.10')).toBeGreaterThan(numbers.indexOf('1.4.5'))
  })

  it('keeps answers already recorded rather than resetting them', () => {
    const existing = record({ '1.2.3': { result: 'met', reviewedOn: '2026-09-01' } }, 'Alex')

    const rebuilt = blankReview(WCAG22_AA_CRITERIA, existing)

    expect(rebuilt.criteria['1.2.3']).toEqual({ result: 'met', reviewedOn: '2026-09-01' })
    expect(rebuilt.reviewedBy).toBe('Alex')
    expect(answeredCount(rebuilt)).toBe(1)
  })

  it('keeps an entry for a criterion it does not know about', () => {
    // More likely a newer WCAG than a mistake, and it is somebody's work either
    // way: dropping it silently would lose a review nobody could redo.
    const existing = record({ '9.9.9': { result: 'met' } })

    expect(blankReview(WCAG22_AA_CRITERIA, existing).criteria['9.9.9']).toEqual({ result: 'met' })
  })
})

describe('what counts', () => {
  const met = record({ '1.2.3': { result: 'met', reviewedOn: '2026-09-01' } })

  it('counts an entry on a criterion the engine did not reach', () => {
    const review = criterionReview('1.2.3', { record: met, today: TODAY }, false)

    expect(review).toMatchObject({ result: 'met', counts: true })
  })

  it('never counts one on a criterion the engine decided for itself', () => {
    const review = criterionReview('1.2.3', { record: met, today: TODAY }, true)

    expect(review).toMatchObject({ counts: false, ignored: 'engine-reached-a-verdict' })
  })

  it('does not count unreviewed, which is what an untouched record is full of', () => {
    const blank = record({ '1.2.3': { result: 'unreviewed' } })

    expect(criterionReview('1.2.3', { record: blank, today: TODAY }, false)).toBeUndefined()
  })

  it('does not count an entry older than the maximum age', () => {
    const old = record({ '1.2.3': { result: 'met', reviewedOn: '2020-01-01' } })

    const review = criterionReview('1.2.3', { record: old, maxAgeDays: 365, today: TODAY }, false)

    expect(review).toMatchObject({ counts: false, ignored: 'stale' })
  })

  it('counts one inside the maximum age', () => {
    const review = criterionReview('1.2.3', { record: met, maxAgeDays: 365, today: TODAY }, false)

    expect(review).toMatchObject({ counts: true })
  })

  it('does not count an undated entry once a maximum age is asked for', () => {
    // An undated review cannot be shown to still hold, which is the whole
    // question --review-max-age asks.
    const undated = record({ '1.2.3': { result: 'met' } })

    const review = criterionReview(
      '1.2.3',
      { record: undated, maxAgeDays: 365, today: TODAY },
      false,
    )

    expect(review).toMatchObject({ counts: false, ignored: 'undated' })
  })

  it('counts an undated entry when no maximum age was asked for', () => {
    const undated = record({ '1.2.3': { result: 'met' } })

    expect(criterionReview('1.2.3', { record: undated, today: TODAY }, false)).toMatchObject({
      counts: true,
    })
  })

  it('attributes an entry to whoever the record names', () => {
    const attributed = criterionReview('1.2.3', { record: record(met.criteria, 'Alex') }, false)

    expect(attributed?.reviewedBy).toBe('Alex')
  })
})

describe('coverage with a review', () => {
  it('counts reviewed criteria apart from the four the engine partitions', () => {
    const supplied = record({
      // Two the engine cannot reach at all, one of them a failure.
      '1.2.3': { result: 'met', reviewedOn: '2026-09-01' },
      '1.3.2': { result: 'not-met', reviewedOn: '2026-09-01' },
      // One the engine decided here, which must not extend the run's reach.
      '1.1.1': { result: 'met', reviewedOn: '2026-09-01' },
    })

    const coverage = buildCoverage(audits, undefined, { record: supplied, today: TODAY })
    const plain = buildCoverage(audits)

    expect(coverage.reviewed).toBe(2)
    expect(coverage.reviewedNotMet).toBe(1)
    expect(coverage.reviewNotCounted).toBe(1)
    // The engine's own four are untouched by anything a person wrote down.
    expect(coverage.evaluated).toBe(plain.evaluated)
    expect(coverage.notEvaluated).toBe(plain.notEvaluated)
    expect(coverage.nothingToCheck).toBe(plain.nothingToCheck)
    expect(coverage.noAutomatedRule).toBe(plain.noAutomatedRule)
  })

  it('leaves every criterion status where the engine put it', () => {
    const supplied = record({ '1.3.2': { result: 'met', reviewedOn: '2026-09-01' } })

    const withReview = buildCoverage(audits, undefined, { record: supplied, today: TODAY })
    const without = buildCoverage(audits)

    expect(withReview.criteria.map((criterion) => criterion.status)).toEqual(
      without.criteria.map((criterion) => criterion.status),
    )
  })

  it('says nothing about a review when there was none', () => {
    const coverage = buildCoverage(audits)

    expect(coverage.reviewed).toBe(0)
    expect(reviewSummary(coverage)).toBeUndefined()
  })

  it('says a review is a claim rather than a measurement', () => {
    const supplied = record({ '1.2.3': { result: 'met', reviewedOn: '2026-09-01' } })

    const summary = reviewSummary(buildCoverage(audits, undefined, { record: supplied }))

    expect(summary).toContain('claim by a person, not a measurement')
  })
})

describe('the file', () => {
  it('round-trips through disk', async () => {
    const dir = await workspace()
    const written = record({ '1.2.3': { result: 'met', reviewedOn: '2026-09-01' } }, 'Alex')

    await writeReview(DEFAULT_REVIEW_FILE, written, dir)

    expect(await readReview(DEFAULT_REVIEW_FILE, dir)).toEqual(written)
  })

  it('ends with a newline, so it lands well in a repository', () => {
    expect(serialiseReview(blankReview(WCAG22_AA_CRITERIA))).toMatch(/\n$/)
  })

  it('refuses a file that is not a review record', async () => {
    const dir = await workspace()
    await writeFile(path.join(dir, DEFAULT_REVIEW_FILE), '{"criteria": 3}', 'utf8')

    await expect(readReview(DEFAULT_REVIEW_FILE, dir)).rejects.toThrow(ReviewError)
  })

  it('refuses a record written under another schema version', async () => {
    const dir = await workspace()
    await writeFile(
      path.join(dir, DEFAULT_REVIEW_FILE),
      JSON.stringify({ schemaVersion: 99, criteria: {} }),
      'utf8',
    )

    await expect(readReview(DEFAULT_REVIEW_FILE, dir)).rejects.toThrow(/schemaVersion 99/)
  })

  it('says how to make one when there is none', async () => {
    const dir = await workspace()

    await expect(readReview(DEFAULT_REVIEW_FILE, dir)).rejects.toThrow(/eaa-kit checklist/)
  })

  it('refuses a result it does not recognise rather than treating it as met', async () => {
    const dir = await workspace()
    await writeFile(
      path.join(dir, DEFAULT_REVIEW_FILE),
      JSON.stringify({ schemaVersion: 1, criteria: { '1.2.3': { result: 'probably-fine' } } }),
      'utf8',
    )

    await expect(readReview(DEFAULT_REVIEW_FILE, dir)).rejects.toThrow(ReviewError)
  })

  it('is written as JSON somebody can edit by hand', async () => {
    const dir = await workspace()
    await writeReview(DEFAULT_REVIEW_FILE, blankReview(WCAG22_AA_CRITERIA), dir)

    const raw = await readFile(path.join(dir, DEFAULT_REVIEW_FILE), 'utf8')

    expect(raw).toContain('\n  "criteria": {')
  })
})
