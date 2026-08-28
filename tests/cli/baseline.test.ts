import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readBaseline } from '../../src/audit/baseline.ts'
import { runAuditCommand } from '../../src/cli/audit.ts'
import { runBaselineCommand } from '../../src/cli/baseline.ts'

const SITE = fileURLToPath(new URL('../fixtures/site', import.meta.url))

const dirs: string[] = []
let stdout: string[]
let stderr: string[]

/** A copy of the fixture site, so a test can add a page to it. */
async function site(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-baseline-cli-'))
  dirs.push(dir)
  await cp(SITE, path.join(dir, 'dist'), { recursive: true })
  return dir
}

/** A page carrying a violation that is not in the fixture site. */
async function addPage(dir: string, name: string): Promise<void> {
  await writeFile(
    path.join(dir, 'dist', name),
    '<!doctype html><html lang="de"><head><title>Neu</title></head><body><main><img src="/x.png"></main></body></html>',
    'utf8',
  )
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

describe('runBaselineCommand', () => {
  it('writes an entry for every violation the build already has', async () => {
    const dir = await site()

    const { entries, exitCode } = await runBaselineCommand('dist', { cwd: dir })

    expect(exitCode).toBe(0)
    expect(entries).toBe(3)
    expect(await readBaseline('eaa-baseline.json', dir)).toMatchObject({ schemaVersion: 1 })
  })

  it('says the file is a list of barriers, not a way to switch the tool off', async () => {
    await runBaselineCommand('dist', { cwd: await site() })

    expect(stderr.join('')).toContain('These are barriers, not exceptions')
  })

  it('writes where it is told', async () => {
    const dir = await site()

    await runBaselineCommand('dist', { cwd: dir, output: 'config/base.json' })

    expect(await readBaseline('config/base.json', dir)).toBeDefined()
  })

  it('records a note and an expiry on every entry', async () => {
    const dir = await site()

    await runBaselineCommand('dist', {
      cwd: dir,
      note: 'agreed with the client',
      expiresOn: '2027-01-01',
    })

    const baseline = await readBaseline('eaa-baseline.json', dir)
    expect(baseline.entries.every((entry) => entry.note === 'agreed with the client')).toBe(true)
    expect(baseline.entries.every((entry) => entry.expiresOn === '2027-01-01')).toBe(true)
  })

  it('refuses to write one from a run that could not finish', async () => {
    // A baseline built from a half-read build accepts an unknown amount of
    // nothing, which is worse than having no baseline.
    const dir = await site()
    await writeFile(path.join(dir, 'dist', 'broken.html'), '<!doctype html><p>x', 'utf8')

    const { exitCode } = await runBaselineCommand('dist', { cwd: dir, timeoutMs: 1 })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('no baseline was written')
  })

  it('exits 2 when the directory is not there', async () => {
    const { exitCode } = await runBaselineCommand('nope', { cwd: await site() })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Build directory not found')
  })

  it('exits 2 when there is no HTML to audit', async () => {
    const dir = await site()

    const { exitCode } = await runBaselineCommand('dist', { cwd: dir, include: ['**/*.xhtml'] })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('holds no HTML')
  })
})

describe('audit --baseline', () => {
  it('passes a build whose violations are all accounted for', async () => {
    const dir = await site()
    await runBaselineCommand('dist', { cwd: dir })

    const failing = await runAuditCommand(path.join(dir, 'dist'))
    const accepted = await runAuditCommand(path.join(dir, 'dist'), {
      cwd: dir,
      baseline: 'eaa-baseline.json',
    })

    expect(failing.exitCode).toBe(1)
    expect(accepted.exitCode).toBe(0)
  })

  it('still fails on a violation the baseline never saw', async () => {
    // The safety property the whole feature rests on.
    const dir = await site()
    await runBaselineCommand('dist', { cwd: dir })
    await addPage(dir, 'neu.html')

    const { exitCode, audits } = await runAuditCommand(path.join(dir, 'dist'), {
      cwd: dir,
      baseline: 'eaa-baseline.json',
    })

    expect(exitCode).toBe(1)
    const added = audits.find((audit) => audit.relativePath === 'neu.html')
    expect(added?.violations.length).toBeGreaterThan(0)
  })

  it('keeps the accepted violations in the report rather than dropping them', async () => {
    const dir = await site()
    await runBaselineCommand('dist', { cwd: dir })

    const { audits } = await runAuditCommand(path.join(dir, 'dist'), {
      cwd: dir,
      baseline: 'eaa-baseline.json',
    })
    const index = audits.find((audit) => audit.relativePath === 'index.html')

    expect(index?.violations).toEqual([])
    expect(index?.accepted?.length).toBeGreaterThan(0)
    expect(stdout.join('')).toContain('accepted by the baseline')
  })

  it('never calls a page with accepted violations clean', async () => {
    const dir = await site()
    await runBaselineCommand('dist', { cwd: dir })

    await runAuditCommand(path.join(dir, 'dist'), { cwd: dir, baseline: 'eaa-baseline.json' })

    expect(stdout.join('')).toContain('no new violations')
  })

  it('says how many it accepted', async () => {
    const dir = await site()
    await runBaselineCommand('dist', { cwd: dir })

    await runAuditCommand(path.join(dir, 'dist'), { cwd: dir, baseline: 'eaa-baseline.json' })

    expect(stderr.join('')).toContain('Baseline accepted 3 violating elements')
  })

  it('points out entries that no longer match, so the file can shrink', async () => {
    const dir = await site()
    await runBaselineCommand('dist', { cwd: dir })
    // index.html is the page carrying the violations; replacing it with a clean
    // one leaves its entries genuinely unmatched.
    await writeFile(
      path.join(dir, 'dist', 'index.html'),
      '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Neu</title></head><body><main><h1>Neu</h1></main></body></html>',
      'utf8',
    )

    await runAuditCommand(path.join(dir, 'dist'), { cwd: dir, baseline: 'eaa-baseline.json' })

    expect(stderr.join('')).toContain('no longer match')
  })

  it('does not tell you to delete entries for pages it never audited', async () => {
    // Following that advice after a narrowed run would remove the entries
    // protecting the rest of the site.
    const dir = await site()
    await runBaselineCommand('dist', { cwd: dir })

    await runAuditCommand(path.join(dir, 'dist'), {
      cwd: dir,
      baseline: 'eaa-baseline.json',
      include: ['about/**'],
    })

    expect(stderr.join('')).not.toContain('can be removed')
  })

  it('resolves --output against the working directory it was given', async () => {
    const dir = await site()

    await runAuditCommand(path.join(dir, 'dist'), {
      cwd: dir,
      format: 'json',
      output: 'reports/a11y.json',
    })

    expect(JSON.parse(await readFile(path.join(dir, 'reports/a11y.json'), 'utf8'))).toMatchObject({
      schemaVersion: 1,
    })
  })

  it('warns when entries have expired, and fails on them again', async () => {
    const dir = await site()
    await runBaselineCommand('dist', { cwd: dir, expiresOn: '2020-01-01' })

    const { exitCode } = await runAuditCommand(path.join(dir, 'dist'), {
      cwd: dir,
      baseline: 'eaa-baseline.json',
    })

    expect(exitCode).toBe(1)
    expect(stderr.join('')).toContain('have expired')
  })

  it('exits 2 rather than auditing against a baseline it cannot find', async () => {
    const dir = await site()

    const { exitCode } = await runAuditCommand(path.join(dir, 'dist'), {
      cwd: dir,
      baseline: 'missing.json',
    })

    expect(exitCode).toBe(2)
    expect(stderr.join('')).toContain('Could not read the baseline')
  })

  it('exits 2 on a baseline it cannot parse', async () => {
    const dir = await site()
    await writeFile(path.join(dir, 'bad.json'), '{ nope', 'utf8')

    const { exitCode } = await runAuditCommand(path.join(dir, 'dist'), {
      cwd: dir,
      baseline: 'bad.json',
    })

    expect(exitCode).toBe(2)
  })
})

describe('the reports', () => {
  it('carries accepted violations in the JSON document', async () => {
    const dir = await site()
    await runBaselineCommand('dist', { cwd: dir })

    await runAuditCommand(path.join(dir, 'dist'), {
      cwd: dir,
      baseline: 'eaa-baseline.json',
      format: 'json',
      output: path.join(dir, 'a11y.json'),
    })

    const doc = JSON.parse(await readFile(path.join(dir, 'a11y.json'), 'utf8'))
    expect(doc.summary.accepted).toBe(3)
    expect(doc.summary.failing).toBe(0)
    const index = doc.pages.find((entry: { path: string }) => entry.path === 'index.html')
    expect(index.accepted).toHaveLength(3)
    expect(index.violations).toEqual([])
  })

  it('suppresses them in SARIF rather than dropping or reporting them', async () => {
    // GitHub shows a suppressed result as closed. Emitting them as ordinary
    // results would fail the build the baseline exists to unblock; leaving
    // them out would hide a defect the project has on record.
    const dir = await site()
    await runBaselineCommand('dist', { cwd: dir })

    await runAuditCommand(path.join(dir, 'dist'), {
      cwd: dir,
      baseline: 'eaa-baseline.json',
      format: 'sarif',
      output: path.join(dir, 'a11y.sarif'),
    })

    const log = JSON.parse(await readFile(path.join(dir, 'a11y.sarif'), 'utf8'))
    const results = log.runs[0].results as Array<{ suppressions?: unknown[] }>
    expect(results).toHaveLength(3)
    expect(results.every((result) => result.suppressions?.length === 1)).toBe(true)
    expect(log.runs[0].results[0].suppressions[0]).toEqual({
      kind: 'external',
      justification: 'Recorded in the eaa-kit baseline',
    })
  })

  it('shows them in the HTML report without calling the page clean', async () => {
    const dir = await site()
    await runBaselineCommand('dist', { cwd: dir })

    await runAuditCommand(path.join(dir, 'dist'), {
      cwd: dir,
      baseline: 'eaa-baseline.json',
      format: 'html',
      output: path.join(dir, 'a11y.html'),
    })

    const html = await readFile(path.join(dir, 'a11y.html'), 'utf8')
    expect(html).toContain('Accepted by the baseline')
    expect(html).toContain('No new violations.')
    expect(html).toContain('accepted by the baseline, and not counted above')
  })
})
