import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_REVIEW_FILE, readReview } from '../../src/audit/review.ts'
import { type AuditCommandOptions, runAuditCommand as runAudit } from '../../src/cli/audit.ts'
import { runChecklistCommand } from '../../src/cli/checklist.ts'

const SITE = fileURLToPath(new URL('../fixtures/site', import.meta.url))

/** Cold every time: what a review changes is asserted here, not what a cache does. */
function runAuditCommand(
  dir: string | undefined,
  options: AuditCommandOptions = {},
): ReturnType<typeof runAudit> {
  return runAudit(dir, { noCache: true, ...options })
}

const dirs: string[] = []
let stdout: string[]
let stderr: string[]

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-checklist-'))
  dirs.push(dir)
  return dir
}

beforeEach(() => {
  stdout = []
  stderr = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('eaa-kit checklist', () => {
  it('writes a record and a worksheet', async () => {
    const cwd = await workspace()

    const { exitCode } = await runChecklistCommand({ cwd, output: 'review.md' })

    expect(exitCode).toBe(0)
    const record = await readReview(DEFAULT_REVIEW_FILE, cwd)
    expect(Object.keys(record.criteria)).toHaveLength(55)
    const worksheet = await readFile(path.join(cwd, 'review.md'), 'utf8')
    expect(worksheet).toContain('34 have no automated rule at all')
  })

  it('sends the worksheet to stdout when no output is named', async () => {
    const cwd = await workspace()

    await runChecklistCommand({ cwd })

    expect(stdout.join('')).toContain('# Manual accessibility review')
  })

  it('names the record the worksheet belongs to, wherever it was put', async () => {
    const cwd = await workspace()

    await runChecklistCommand({ cwd, record: 'audit/review.json' })

    expect(stdout.join('')).toContain('audit/review.json')
    await expect(readReview('audit/review.json', cwd)).resolves.toBeDefined()
  })

  it('keeps answers when it is run again', async () => {
    const cwd = await workspace()
    await runChecklistCommand({ cwd })
    const first = await readReview(DEFAULT_REVIEW_FILE, cwd)
    first.criteria['1.2.3'] = { result: 'met', reviewedOn: '2026-09-01', note: 'No video.' }
    await writeFile(
      path.join(cwd, DEFAULT_REVIEW_FILE),
      `${JSON.stringify(first, null, 2)}\n`,
      'utf8',
    )

    await runChecklistCommand({ cwd })

    const again = await readReview(DEFAULT_REVIEW_FILE, cwd)
    expect(again.criteria['1.2.3']).toEqual({
      result: 'met',
      reviewedOn: '2026-09-01',
      note: 'No video.',
    })
    expect(stderr.join('')).toContain('1 criterion already answered')
  })

  it('records who is doing the review', async () => {
    const cwd = await workspace()

    await runChecklistCommand({ cwd, reviewedBy: 'Alex Reviewer' })

    expect((await readReview(DEFAULT_REVIEW_FILE, cwd)).reviewedBy).toBe('Alex Reviewer')
  })

  it('refuses to overwrite a record it cannot read', async () => {
    // The record holds work no tool can redo. A typo in it is a reason to stop,
    // never a reason to start again from blank.
    const cwd = await workspace()
    await writeFile(path.join(cwd, DEFAULT_REVIEW_FILE), '{ not json', 'utf8')

    const { exitCode } = await runChecklistCommand({ cwd })

    expect(exitCode).toBe(2)
    expect(await readFile(path.join(cwd, DEFAULT_REVIEW_FILE), 'utf8')).toBe('{ not json')
  })

  it('marks answered criteria in the worksheet', async () => {
    const cwd = await workspace()
    await runChecklistCommand({ cwd })
    const record = await readReview(DEFAULT_REVIEW_FILE, cwd)
    record.criteria['1.3.2'] = { result: 'not-met', reviewedOn: '2026-09-01', note: 'Sidebar.' }
    await writeFile(
      path.join(cwd, DEFAULT_REVIEW_FILE),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8',
    )

    await runChecklistCommand({ cwd, output: 'review.md' })

    const worksheet = await readFile(path.join(cwd, 'review.md'), 'utf8')
    expect(worksheet).toContain('- [x] **1.3.2 Meaningful Sequence**')
    expect(worksheet).toContain('Recorded: not-met (on 2026-09-01)')
    expect(worksheet).toContain('Note: Sidebar.')
  })
})

describe('eaa-kit audit --review', () => {
  async function reviewed(cwd: string, criteria: Record<string, unknown>): Promise<void> {
    await runChecklistCommand({ cwd, output: 'worksheet.md' })
    const record = await readReview(DEFAULT_REVIEW_FILE, cwd)
    await writeFile(
      path.join(cwd, DEFAULT_REVIEW_FILE),
      `${JSON.stringify({ ...record, criteria: { ...record.criteria, ...criteria } }, null, 2)}\n`,
      'utf8',
    )
    // The setup wrote its own output; the assertions below are about the audit.
    stdout.length = 0
    stderr.length = 0
  }

  it('reports what a person recorded, beside what the run reached', async () => {
    const cwd = await workspace()
    await reviewed(cwd, { '1.3.2': { result: 'met', reviewedOn: '2026-09-01' } })

    await runAuditCommand(SITE, {
      cwd,
      include: ['about/**'],
      review: DEFAULT_REVIEW_FILE,
      coverage: true,
    })

    const report = stdout.join('')
    expect(report).toContain('A person recorded a result for 1')
    expect(report).toContain('claim by a person')
  })

  it('never lets a review overrule the engine', async () => {
    const cwd = await workspace()
    // 1.1.1 is the criterion the fixture site fails, and this run reaches it.
    await reviewed(cwd, { '1.1.1': { result: 'met', reviewedOn: '2026-09-01' } })

    const { exitCode } = await runAuditCommand(SITE, {
      cwd,
      review: DEFAULT_REVIEW_FILE,
      format: 'json',
    })

    const report = JSON.parse(stdout.join(''))
    const criterion = report.coverage.criteria.find(
      (entry: { number: string }) => entry.number === '1.1.1',
    )
    expect(criterion.status).toBe('evaluated')
    expect(criterion.review).toMatchObject({ counts: false, ignored: 'engine-reached-a-verdict' })
    // The violations still fail the run, whatever anybody recorded.
    expect(exitCode).toBe(1)
  })

  it('stops when the record it was told to read is not there', async () => {
    const cwd = await workspace()

    const { exitCode } = await runAuditCommand(SITE, {
      cwd,
      include: ['about/**'],
      review: 'nowhere.json',
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Could not read the review record')
  })

  it('runs exactly as before when no review is given', async () => {
    const cwd = await workspace()

    await runAuditCommand(SITE, { cwd, include: ['about/**'], format: 'json' })

    const report = JSON.parse(stdout.join(''))
    expect(report.coverage.reviewed).toBe(0)
    expect(report.coverage.reviewNotCounted).toBe(0)
    expect(stdout.join('')).not.toContain('checked by hand')
  })
})
