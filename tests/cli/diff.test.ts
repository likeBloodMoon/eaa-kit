import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDiffCommand } from '../../src/cli/diff.ts'

const dirs: string[] = []

let stdout: string[]
let stderr: string[]

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

interface Violation {
  ruleId: string
  impact?: string
  html?: string
}

async function reports(
  before: Violation[],
  after: Violation[],
  afterPages = ['index.html'],
): Promise<{ base: string; head: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-diffcli-'))
  dirs.push(dir)

  const document = (violations: Violation[], pages: string[]): unknown => ({
    schemaVersion: 1,
    generatedAt: '2026-08-20T18:00:00.000Z',
    target: { source: './dist' },
    completeness: { complete: true, audited: pages.length },
    rules: { 'image-alt': { help: 'Images must have alternative text' } },
    pages: pages.map((page, index) => ({
      path: page,
      error: null,
      violations:
        index > 0
          ? []
          : violations.map((violation) => ({
              ruleId: violation.ruleId,
              impact: violation.impact ?? 'critical',
              nodes: [{ html: violation.html ?? '<img src="/a.png">', target: ['img'] }],
            })),
    })),
  })

  const base = path.join(dir, 'base.json')
  const head = path.join(dir, 'head.json')
  await writeFile(base, JSON.stringify(document(before, ['index.html'])))
  await writeFile(head, JSON.stringify(document(after, afterPages)))
  return { base, head }
}

describe('runDiffCommand', () => {
  it('exits 0 and says so when nothing changed', async () => {
    const { base, head } = await reports([{ ruleId: 'image-alt' }], [{ ruleId: 'image-alt' }])

    const { exitCode } = await runDiffCommand(base, head)

    expect(exitCode).toBe(0)
    expect(stdout.join('')).toContain('No change in violations')
  })

  it('exits 1 on a new violation at or above the threshold', async () => {
    const { base, head } = await reports([], [{ ruleId: 'image-alt', impact: 'critical' }])

    const { exitCode } = await runDiffCommand(base, head)

    expect(exitCode).toBe(1)
    expect(stdout.join('')).toContain('New (1)')
  })

  it('exits 0 on a new violation below the threshold', async () => {
    const { base, head } = await reports([], [{ ruleId: 'image-alt', impact: 'minor' }])

    const { exitCode } = await runDiffCommand(base, head, { failOn: 'serious' })

    expect(exitCode).toBe(0)
  })

  it('does not fail on pre-existing violations, only on new ones', async () => {
    // A diff that failed on what was already there would be an audit with extra
    // steps, and would go red on every branch of a site that has any debt.
    const { base, head } = await reports(
      [{ ruleId: 'image-alt', impact: 'critical' }],
      [{ ruleId: 'image-alt', impact: 'critical' }],
    )

    expect((await runDiffCommand(base, head)).exitCode).toBe(0)
  })

  it('warns on stderr about violations it could not compare', async () => {
    // The document may have gone to a file; this is the part somebody must act
    // on either way.
    const { base, head } = await reports([{ ruleId: 'image-alt' }], [], ['other.html'])

    await runDiffCommand(base, head)

    expect(stderr.join('')).toContain('could not be compared')
    expect(stdout.join('')).toContain('Not compared (1)')
    expect(stdout.join('')).not.toContain('Fixed (1)')
  })

  it('writes a machine-readable diff with --format json', async () => {
    const { base, head } = await reports([], [{ ruleId: 'image-alt' }])

    await runDiffCommand(base, head, { format: 'json' })

    const document = JSON.parse(stdout.join(''))
    expect(document.summary).toMatchObject({ added: 1, fixed: 0, failing: 1 })
    expect(document.added[0]).toMatchObject({ ruleId: 'image-alt', page: 'index.html' })
    expect(document.added[0].fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('writes to a file with --output, leaving stdout empty', async () => {
    const { base, head } = await reports([], [{ ruleId: 'image-alt' }])
    const target = path.join(path.dirname(base), 'nested', 'diff.json')

    await runDiffCommand(base, head, { format: 'json', output: target })

    expect(stdout.join('')).toBe('')
    expect(JSON.parse(await readFile(target, 'utf8'))).toMatchObject({ summary: { added: 1 } })
  })

  it('exits 2 when a report cannot be read, rather than reporting no change', async () => {
    const { base } = await reports([], [])

    const { exitCode } = await runDiffCommand(base, './nowhere.json')

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Report not found')
  })
})
