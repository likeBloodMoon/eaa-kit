import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiffError, diffReports, readReport } from '../../src/audit/diff.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

interface PageSpec {
  path: string
  error?: string
  violations?: Array<{ ruleId: string; impact?: string; html?: string; target?: string[] }>
}

/** A JSON report with only the fields a diff reads. */
function report(pages: PageSpec[], overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-20T18:00:00.000Z',
    target: { source: './dist' },
    completeness: { complete: true, audited: pages.filter((p) => !p.error).length },
    rules: { 'image-alt': { help: 'Images must have alternative text' } },
    pages: pages.map((page) => ({
      path: page.path,
      error: page.error ?? null,
      violations: (page.violations ?? []).map((violation) => ({
        ruleId: violation.ruleId,
        impact: violation.impact ?? 'critical',
        nodes: [
          { html: violation.html ?? '<img src="/a.png">', target: violation.target ?? ['img'] },
        ],
      })),
    })),
    ...overrides,
  }
}

/** Parse through the real reader, so the tests exercise the schema too. */
async function parsed(document: unknown): Promise<Awaited<ReturnType<typeof readReport>>> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-diff-'))
  dirs.push(dir)
  const file = path.join(dir, 'report.json')
  await writeFile(file, JSON.stringify(document))
  return readReport(file)
}

async function compare(base: unknown, head: unknown) {
  return diffReports(await parsed(base), await parsed(head))
}

describe('diffReports', () => {
  it('reports a violation only in the later run as new', async () => {
    const diff = await compare(
      report([{ path: 'index.html' }]),
      report([{ path: 'index.html', violations: [{ ruleId: 'image-alt' }] }]),
    )

    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]).toMatchObject({ ruleId: 'image-alt', page: 'index.html' })
    expect(diff.fixed).toEqual([])
  })

  it('reports a violation gone from a page that was audited again as fixed', async () => {
    const diff = await compare(
      report([{ path: 'index.html', violations: [{ ruleId: 'image-alt' }] }]),
      report([{ path: 'index.html' }]),
    )

    expect(diff.fixed).toHaveLength(1)
    expect(diff.added).toEqual([])
  })

  it('reports a violation present in both as unchanged', async () => {
    const one = report([{ path: 'index.html', violations: [{ ruleId: 'image-alt' }] }])
    const diff = await compare(one, one)

    expect(diff.unchanged).toHaveLength(1)
    expect(diff.added).toEqual([])
    expect(diff.fixed).toEqual([])
  })

  it('refuses to call a violation fixed when the later run never audited its page', async () => {
    // The whole point. A crawl that stopped early would otherwise read as a
    // changelog of work nobody did.
    const diff = await compare(
      report([
        { path: 'index.html', violations: [{ ruleId: 'image-alt' }] },
        { path: 'about.html', violations: [{ ruleId: 'image-alt', html: '<img src="/b.png">' }] },
      ]),
      report([{ path: 'index.html' }]),
    )

    expect(diff.fixed.map((entry) => entry.page)).toEqual(['index.html'])
    expect(diff.unmeasured.map((entry) => entry.page)).toEqual(['about.html'])
  })

  it('does not count a page that errored as evidence that anything was fixed', async () => {
    // The page was reached and then not audited, so it testifies to nothing.
    const diff = await compare(
      report([{ path: 'index.html', violations: [{ ruleId: 'image-alt' }] }]),
      report([{ path: 'index.html', error: 'axe-core timed out' }]),
    )

    expect(diff.fixed).toEqual([])
    expect(diff.unmeasured).toHaveLength(1)
  })

  it('treats changed markup as a different violation rather than the same one', async () => {
    // The conservative reading: it avoids quietly calling something fixed
    // because its surroundings moved.
    const diff = await compare(
      report([
        { path: 'index.html', violations: [{ ruleId: 'image-alt', html: '<img src="/a.png">' }] },
      ]),
      report([
        { path: 'index.html', violations: [{ ruleId: 'image-alt', html: '<img src="/b.png">' }] },
      ]),
    )

    expect(diff.added).toHaveLength(1)
    expect(diff.fixed).toHaveLength(1)
    expect(diff.unchanged).toEqual([])
  })

  it('tells the same violation on two pages apart', async () => {
    const diff = await compare(
      report([{ path: 'index.html', violations: [{ ruleId: 'image-alt' }] }]),
      report([
        { path: 'index.html', violations: [{ ruleId: 'image-alt' }] },
        { path: 'about.html', violations: [{ ruleId: 'image-alt' }] },
      ]),
    )

    expect(diff.added.map((entry) => entry.page)).toEqual(['about.html'])
    expect(diff.unchanged.map((entry) => entry.page)).toEqual(['index.html'])
  })

  it('gives a document-level violation an identity even with no element', async () => {
    // A rule can fail with nothing attached. Getting this wrong would make such
    // failures invisible to a diff while still visible to the baseline.
    const withNoNodes = {
      schemaVersion: 1,
      generatedAt: '2026-08-20T18:00:00.000Z',
      pages: [{ path: 'index.html', violations: [{ ruleId: 'html-has-lang', nodes: [] }] }],
    }

    const diff = await compare(withNoNodes, report([{ path: 'index.html' }]))

    expect(diff.fixed).toHaveLength(1)
    expect(diff.fixed[0]?.selector).toBe('')
  })

  it('carries what each run measured, so a reader can weigh the comparison', async () => {
    const diff = await compare(
      report([{ path: 'index.html' }]),
      report([{ path: 'index.html' }], { completeness: { complete: false, audited: 1 } }),
    )

    expect(diff.base.complete).toBe(true)
    expect(diff.head.complete).toBe(false)
  })

  it('says coverage is unknown for a report written before completeness existed', async () => {
    // Absent is not the same as complete.
    const diff = await compare(
      report([{ path: 'index.html' }], { completeness: undefined }),
      report([{ path: 'index.html' }]),
    )

    expect(diff.base.complete).toBeUndefined()
  })
})

describe('readReport', () => {
  it('refuses a schema version it was not written against', async () => {
    await expect(parsed(report([{ path: 'index.html' }], { schemaVersion: 2 }))).rejects.toThrow(
      DiffError,
    )
  })

  it('refuses a file that is not a report', async () => {
    await expect(parsed({ hello: 'world' })).rejects.toThrow(DiffError)
  })

  it('names a file that is not there rather than throwing a system error', async () => {
    await expect(readReport('./nowhere.json')).rejects.toThrow(/Report not found/)
  })
})
