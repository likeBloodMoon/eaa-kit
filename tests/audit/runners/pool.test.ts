import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CollectedPage } from '../../../src/audit/collect.ts'
import { collectPages } from '../../../src/audit/collect.ts'
import { runJsdomAudit } from '../../../src/audit/runners/jsdom.ts'
import {
  estimateWorkMs,
  findWorkerEntry,
  plannedWorkers,
  runPooledAudit,
} from '../../../src/audit/runners/pool.ts'

const SITE = path.join(import.meta.dirname, '../../fixtures/site')

async function fixturePages(): Promise<CollectedPage[]> {
  return collectPages(SITE)
}

/** Copies of one fixture page under distinct paths, to fill a pool. */
async function repeated(count: number): Promise<CollectedPage[]> {
  const html = await readFile(path.join(SITE, 'index.html'), 'utf8')
  return Array.from({ length: count }, (_, index) => ({
    absolutePath: path.join(SITE, `page-${index}.html`),
    relativePath: `page-${index}.html`,
    html,
  }))
}

/** Pages of a given size, which is all the estimate looks at. */
function sized(count: number, bytes: number): CollectedPage[] {
  return Array.from({ length: count }, (_, index) => ({
    absolutePath: `/dist/page-${index}.html`,
    relativePath: `page-${index}.html`,
    html: 'x'.repeat(bytes),
  }))
}

/** About what a real marketing or blog page costs. */
const REAL = 12_000
/** About what a stub page costs. */
const STUB = 190

describe('estimateWorkMs', () => {
  it('charges for the document as well as for the markup in it', () => {
    // Two pages of nothing still cost something to build and set axe-core up on.
    expect(estimateWorkMs(sized(2, 0))).toBeGreaterThan(0)
    expect(estimateWorkMs(sized(2, REAL))).toBeGreaterThan(estimateWorkMs(sized(2, 0)))
  })

  it('lands in the region of what those pages actually take', () => {
    // Measured: ~30 ms for a stub page, ~200 ms for a real one. The estimate is
    // deliberately coarse, so this asserts the order of magnitude rather than
    // the constants, which are free to be retuned.
    expect(estimateWorkMs(sized(1, STUB))).toBeGreaterThan(15)
    expect(estimateWorkMs(sized(1, STUB))).toBeLessThan(45)
    expect(estimateWorkMs(sized(1, REAL))).toBeGreaterThan(150)
    expect(estimateWorkMs(sized(1, REAL))).toBeLessThan(260)
  })

  it('has nothing to estimate for no pages', () => {
    expect(estimateWorkMs([])).toBe(0)
  })
})

describe('plannedWorkers', () => {
  it('does not thread a run too small to pay for the threads', () => {
    // A worker spends ~700 ms loading jsdom before it audits anything.
    expect(plannedWorkers(sized(1, REAL), 4)).toBe(1)
    expect(plannedWorkers(sized(2, REAL), 4)).toBe(1)
  })

  it('decides on the work, not on the number of pages', () => {
    // Four real pages are worth threading; ten stub pages are not, even though
    // there are more of them.
    expect(plannedWorkers(sized(4, REAL), 4)).toBe(2)
    expect(plannedWorkers(sized(10, STUB), 4)).toBe(1)
  })

  it('threads a stub site once there is enough of it', () => {
    expect(plannedWorkers(sized(20, STUB), 4)).toBe(2)
  })

  it('starts at two workers once threading is worth it', () => {
    // One worker would be strictly worse than not threading: same throughput,
    // plus the start-up.
    expect(plannedWorkers(sized(4, REAL), 4)).toBe(2)
    expect(plannedWorkers(sized(16, REAL), 4)).toBe(2)
  })

  it('adds a worker as the work grows', () => {
    expect(plannedWorkers(sized(24, REAL), 8)).toBe(3)
    expect(plannedWorkers(sized(40, REAL), 8)).toBe(5)
  })

  it('leaves a core for the process supervising the workers', () => {
    expect(plannedWorkers(sized(1000, REAL), 4)).toBe(3)
    expect(plannedWorkers(sized(1000, REAL), 9)).toBe(8)
  })

  it('never spawns more than the ceiling, however many cores there are', () => {
    expect(plannedWorkers(sized(10_000, REAL), 64)).toBe(8)
  })

  it('stays single-threaded on a machine with nothing to spare', () => {
    expect(plannedWorkers(sized(500, REAL), 1)).toBe(1)
    expect(plannedWorkers(sized(500, REAL), 2)).toBe(1)
  })

  it('leaves the fixture site on one thread, where it is fastest', () => {
    // Five pages, under a kilobyte between them: threading them measured
    // slower than not, which is the case this estimate exists to catch.
    expect(plannedWorkers(sized(5, 170), 4)).toBe(1)
  })
})

describe('findWorkerEntry', () => {
  it('finds the worker on disk', async () => {
    const entry = await findWorkerEntry()

    expect(entry?.href).toMatch(/worker\.(ts|js)$/)
  })
})

describe('runPooledAudit', () => {
  it('produces exactly what the single-threaded runner produces', async () => {
    const pages = await fixturePages()

    const [sequential, pooled] = await Promise.all([
      runJsdomAudit(pages),
      runPooledAudit(pages, { concurrency: 2 }),
    ])

    // Timings are the one field that legitimately differs between two runs.
    expect(strip(pooled)).toEqual(strip(sequential))
  })

  it('returns pages in the order they were given, not the order they finished', async () => {
    const pages = await repeated(9)

    const audits = await runPooledAudit(pages, { concurrency: 3 })

    expect(audits.map((audit) => audit.relativePath)).toEqual(
      pages.map((page) => page.relativePath),
    )
  })

  it('audits every page exactly once', async () => {
    const pages = await repeated(9)

    const audits = await runPooledAudit(pages, { concurrency: 3 })

    expect(audits).toHaveLength(9)
    expect(audits.every((audit) => audit.error === undefined)).toBe(true)
    expect(audits.every((audit) => audit.violations.length > 0)).toBe(true)
  })

  it('audits in this process when asked for one worker', async () => {
    const pages = await fixturePages()

    const audits = await runPooledAudit(pages, { concurrency: 1 })

    expect(strip(audits)).toEqual(strip(await runJsdomAudit(pages)))
  })

  it('does not hang when there are more workers than pages', async () => {
    const pages = await repeated(2)

    const audits = await runPooledAudit(pages, { concurrency: 6 })

    expect(audits).toHaveLength(2)
  })

  it('has nothing to do with no pages', async () => {
    expect(await runPooledAudit([], { concurrency: 4 })).toEqual([])
  })

  it('records a page it cannot audit rather than dropping it', async () => {
    const pages = await repeated(3)
    const broken = { ...(pages[0] as CollectedPage), html: '' }

    const audits = await runPooledAudit([broken, ...pages.slice(1)], {
      concurrency: 2,
      // Short enough that the empty document's audit cannot finish in time.
      timeoutMs: 1,
    })

    expect(audits).toHaveLength(3)
    expect(audits[0]?.error).toBeDefined()
  })

  it('passes the runner options through to the workers', async () => {
    const pages = await repeated(4)

    const audits = await runPooledAudit(pages, {
      concurrency: 2,
      baseUrl: 'https://example.at',
    })

    expect(audits[0]?.url).toBe('https://example.at/page-0.html')
  })
})

/** Everything a report keeps, minus the one field two runs may disagree on. */
function strip(audits: readonly { durationMs: number }[]): unknown[] {
  return audits.map(({ durationMs: _durationMs, ...rest }) => rest)
}
