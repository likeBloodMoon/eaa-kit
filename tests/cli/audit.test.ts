import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMPACT_LEVELS, type ImpactLevel } from '../../src/audit/impact.ts'
import { runAuditCommand } from '../../src/cli/audit.ts'

const SITE = fileURLToPath(new URL('../fixtures/site', import.meta.url))
const IMPACTS = fileURLToPath(new URL('../fixtures/impacts', import.meta.url))

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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('--fail-on', () => {
  // One page per impact level, each carrying exactly one violation at that
  // level, so the threshold boundary is what decides the exit code.
  const cases: Array<{ page: string; impact: ImpactLevel; failing: ImpactLevel[] }> = [
    { page: 'minor.html', impact: 'minor', failing: ['minor'] },
    { page: 'moderate.html', impact: 'moderate', failing: ['minor', 'moderate'] },
    { page: 'serious.html', impact: 'serious', failing: ['minor', 'moderate', 'serious'] },
    {
      page: 'critical.html',
      impact: 'critical',
      failing: ['minor', 'moderate', 'serious', 'critical'],
    },
  ]

  for (const { page, impact, failing } of cases) {
    for (const failOn of IMPACT_LEVELS) {
      const want = failing.includes(failOn) ? 1 : 0
      it(`exits ${want} for a ${impact} violation with --fail-on ${failOn}`, async () => {
        const { exitCode, audits } = await runAuditCommand(IMPACTS, {
          include: [page],
          failOn,
        })

        expect(audits[0]?.violations.map((finding) => finding.impact)).toEqual([impact])
        expect(exitCode).toBe(want)
      }, 60_000)
    }
  }

  it('defaults to serious, letting a moderate violation through', async () => {
    const { exitCode } = await runAuditCommand(IMPACTS, { include: ['moderate.html'] })

    expect(exitCode).toBe(0)
  }, 60_000)

  it('defaults to serious, failing on a serious violation', async () => {
    const { exitCode } = await runAuditCommand(IMPACTS, { include: ['serious.html'] })

    expect(exitCode).toBe(1)
  }, 60_000)

  it('still reports violations below the threshold, it just does not fail', async () => {
    const { exitCode, audits } = await runAuditCommand(IMPACTS, {
      include: ['minor.html'],
      failOn: 'critical',
    })

    expect(exitCode).toBe(0)
    expect(audits[0]?.violations).toHaveLength(1)
    expect(stdout.join('')).toContain('aria-deprecated-role')
    // and says why the run passed anyway
    expect(stdout.join('')).toContain('none at or above critical')
  }, 60_000)

  it('fails at every level on the fixture site, which has critical findings', async () => {
    for (const failOn of IMPACT_LEVELS) {
      const { exitCode } = await runAuditCommand(SITE, { failOn })

      expect(exitCode).toBe(1)
    }
  }, 120_000)
})

describe('runAuditCommand', () => {
  it('exits 1 when a page has violations', async () => {
    const { exitCode, audits } = await runAuditCommand(SITE)

    expect(exitCode).toBe(1)
    expect(audits).toHaveLength(5)
    expect(stdout.join('')).toContain('image-alt')
  }, 60_000)

  it('exits 0 when every page is clean', async () => {
    const { exitCode } = await runAuditCommand(SITE, { include: ['about/**'] })

    expect(exitCode).toBe(0)
    expect(stdout.join('')).toContain('No violations across 1 page')
  }, 60_000)

  it('writes the report to stdout and progress to stderr', async () => {
    await runAuditCommand(SITE, { include: ['about/**'] })

    expect(stderr.join('')).toContain('Auditing 1 page')
    expect(stdout.join('')).toContain('Summary')
    expect(stderr.join('')).not.toContain('Summary')
  }, 60_000)

  it('honours exclude patterns', async () => {
    const { audits } = await runAuditCommand(SITE, { exclude: ['drafts/**', 'blog/**'] })

    expect(audits.map((audit) => audit.relativePath)).not.toContain('drafts/draft.html')
  }, 60_000)

  it('exits 2 with guidance when the directory does not exist', async () => {
    const { exitCode } = await runAuditCommand(path.join(SITE, 'nope'))

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Build directory not found')
    expect(stderr.join('')).toContain('eaa-kit audit ./dist')
  })

  it('exits 2, not 0, when a page could not be audited', async () => {
    // An unauditable page is not a clean page. Exiting 0 because it happened to
    // produce no violations would hand back a pass for markup nothing read.
    const { exitCode, audits } = await runAuditCommand(SITE, {
      include: ['about/**'],
      timeoutMs: 1,
    })

    expect(audits.every((audit) => audit.error)).toBe(true)
    expect(audits.every((audit) => audit.violations.length === 0)).toBe(true)
    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('could not be audited')
  }, 60_000)

  it('exits 2 when the directory holds no HTML', async () => {
    const empty = await mkdtemp(path.join(tmpdir(), 'eaa-kit-cli-'))
    await writeFile(path.join(empty, 'app.js'), 'export {}', 'utf8')
    try {
      const { exitCode } = await runAuditCommand(empty)

      expect(exitCode).toBe(2)
      expect(stderr.join('')).toContain('No HTML files found')
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})
