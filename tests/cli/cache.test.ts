import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAuditCommand } from '../../src/cli/audit.ts'

const SITE = fileURLToPath(new URL('../fixtures/site', import.meta.url))

/**
 * The pages handed to the engine, per call, in order.
 *
 * A wrapper around the real runner rather than a stand-in: these cases assert
 * on the report as well, and a fake engine would make that assertion about the
 * fake. Written as a plain function rather than `vi.fn` because this file
 * restores mocks between cases and this one has to outlive that.
 *
 * The engine module is imported only when there is something to audit, so an
 * empty list here is the stronger claim: not that the engine did nothing, but
 * that nothing loaded it — which is where the second and a bit of a run go.
 */
const engineCalls: string[][] = []

vi.mock('../../src/audit/runners/pool.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/audit/runners/pool.ts')>()
  return {
    ...actual,
    runPooledAudit: (
      pages: Parameters<typeof actual.runPooledAudit>[0],
      options: Parameters<typeof actual.runPooledAudit>[1],
    ) => {
      engineCalls.push(pages.map((page) => page.relativePath))
      return actual.runPooledAudit(pages, options)
    },
  }
})

const dirs: string[] = []
let stdout: string[]
let stderr: string[]

/** A copy of the fixture site, so a test can edit a page. */
async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-cache-cli-'))
  dirs.push(dir)
  await cp(SITE, path.join(dir, 'dist'), { recursive: true })
  return dir
}

/** The build to audit. Absolute: the audit command resolves it for itself. */
function build(cwd: string): string {
  return path.join(cwd, 'dist')
}

beforeEach(() => {
  stdout = []
  stderr = []
  engineCalls.length = 0
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

function report(): {
  completeness: { audited: number; reused: number; complete: boolean }
  pages: Array<{ path: string; reusedFrom?: string }>
} {
  return JSON.parse(stdout.join(''))
}

describe('auditing only what changed', () => {
  it('audits everything the first time and reuses it the second', async () => {
    const cwd = await project()

    await runAuditCommand(build(cwd), { cwd, format: 'json' })
    expect(report().completeness.reused).toBe(0)

    stdout.length = 0
    await runAuditCommand(build(cwd), { cwd, format: 'json' })

    const second = report()
    expect(second.completeness.audited).toBe(0)
    expect(second.completeness.reused).toBe(5)
    expect(second.pages.every((page) => page.reusedFrom !== undefined)).toBe(true)
  }, 120_000)

  it('never starts an engine for a run with nothing to audit', async () => {
    // The point of the whole thing. Loading jsdom is most of what a small run
    // costs, and a run that reuses every page must not pay it: pages are read
    // and hashed before anything decides an engine is needed.
    const cwd = await project()
    await runAuditCommand(build(cwd), { cwd, format: 'json' })
    expect(engineCalls).toHaveLength(1)
    expect(engineCalls[0]).toHaveLength(5)

    engineCalls.length = 0
    await runAuditCommand(build(cwd), { cwd, format: 'json' })

    expect(engineCalls).toEqual([])
  }, 120_000)

  it('re-audits the page that changed, and only that one', async () => {
    const cwd = await project()
    await runAuditCommand(build(cwd), { cwd, format: 'json' })

    const index = path.join(cwd, 'dist', 'index.html')
    await writeFile(index, (await readFile(index, 'utf8')).replace('Willkommen', 'Hallo'), 'utf8')
    stdout.length = 0
    engineCalls.length = 0
    await runAuditCommand(build(cwd), { cwd, format: 'json' })

    const second = report()
    expect(second.completeness.audited).toBe(1)
    expect(second.completeness.reused).toBe(4)
    expect(second.pages.find((page) => page.path === 'index.html')?.reusedFrom).toBeUndefined()
    // And the engine was handed that page and no other, which is the claim the
    // counts above are downstream of.
    expect(engineCalls).toEqual([['index.html']])
  }, 120_000)

  it('reaches the same findings as a run that reused nothing', async () => {
    // The property the whole feature rests on. If these ever differ, the cache
    // is not a cache, it is a second opinion.
    const cwd = await project()
    await runAuditCommand(build(cwd), { cwd, format: 'json' })
    stdout.length = 0

    await runAuditCommand(build(cwd), { cwd, format: 'json', noCache: true })
    const fresh = report()
    stdout.length = 0
    await runAuditCommand(build(cwd), { cwd, format: 'json' })
    const reused = report()

    expect(findings(reused)).toEqual(findings(fresh))
  }, 180_000)

  it('audits everything again under --no-cache', async () => {
    const cwd = await project()
    await runAuditCommand(build(cwd), { cwd, format: 'json' })
    stdout.length = 0

    await runAuditCommand(build(cwd), { cwd, format: 'json', noCache: true })

    expect(report().completeness.reused).toBe(0)
  }, 120_000)

  it('says on stderr what it reused, not only in the report', async () => {
    const cwd = await project()
    await runAuditCommand(build(cwd), { cwd, format: 'json' })
    stderr.length = 0

    await runAuditCommand(build(cwd), { cwd, format: 'json' })

    expect(stderr.join('')).toContain('Nothing changed')
  }, 120_000)
})

/** Every rule that failed, by page, as a shape two runs can be compared on. */
function findings(parsed: ReturnType<typeof report>): unknown {
  return (parsed as unknown as { pages: Array<{ path: string; violations: unknown[] }> }).pages.map(
    (page) => ({ path: page.path, violations: page.violations }),
  )
}
