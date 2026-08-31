import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { collectPages } from '../../src/audit/collect.ts'
import {
  buildCoverage,
  type Coverage,
  coverageSummary,
  WCAG22_AA_CRITERIA,
} from '../../src/audit/coverage.ts'
import { understandingUrl } from '../../src/audit/manual.ts'
import { type PageAudit, runJsdomAudit } from '../../src/audit/runners/jsdom.ts'

const SITE = fileURLToPath(new URL('../fixtures/site', import.meta.url))

let audits: PageAudit[]
let coverage: Coverage

beforeAll(async () => {
  audits = await runJsdomAudit(await collectPages(SITE))
  coverage = buildCoverage(audits)
}, 60_000)

describe('the criteria table', () => {
  it('is WCAG 2.2 at Levels A and AA, and nothing else', () => {
    expect(WCAG22_AA_CRITERIA).toHaveLength(55)
    for (const criterion of WCAG22_AA_CRITERIA) {
      expect(['A', 'AA']).toContain(criterion.level)
    }
  })

  it('leaves out 4.1.1 Parsing, which WCAG 2.2 removed', () => {
    // Counting it would inflate the denominator with a criterion nobody has to
    // meet, which would understate coverage rather than overstate it — still
    // wrong, and wrong in a way nobody would notice.
    expect(WCAG22_AA_CRITERIA.map((c) => c.number)).not.toContain('4.1.1')
  })

  it('lists each criterion once', () => {
    const numbers = WCAG22_AA_CRITERIA.map((criterion) => criterion.number)

    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('can point at what every criterion requires', () => {
    // The table and the Understanding links are maintained separately; a
    // criterion with no link is one the report can name and not explain.
    const missing = WCAG22_AA_CRITERIA.filter(
      (criterion) => understandingUrl(criterion.number) === undefined,
    )

    expect(missing.map((criterion) => criterion.number)).toEqual([])
  })
})

describe('buildCoverage', () => {
  it('puts every criterion in exactly one bucket', () => {
    // The same one-bucket discipline shapeResults enforces for rules. Two
    // buckets claiming one criterion would make the counts overlap, and a
    // criterion in none would make them silently miss it.
    const counted =
      coverage.evaluated +
      coverage.notEvaluated +
      coverage.nothingToCheck +
      coverage.noAutomatedRule

    expect(counted).toBe(coverage.total)
    expect(coverage.total).toBe(WCAG22_AA_CRITERIA.length)
    expect(coverage.criteria).toHaveLength(WCAG22_AA_CRITERIA.length)
  })

  it('reports the majority of WCAG as unautomatable, because it is', () => {
    // The number this exists to publish. If a change to the rule mapping ever
    // makes this small, something has started overclaiming.
    expect(coverage.noAutomatedRule).toBeGreaterThan(coverage.total / 2)
  })

  it('counts a criterion as evaluated only where a rule reached a verdict', () => {
    // 1.1.1 has image-alt, and the fixture site has images that fail it.
    const nonText = coverage.criteria.find((criterion) => criterion.number === '1.1.1')

    expect(nonText?.status).toBe('evaluated')
    expect(nonText?.rules).toContain('image-alt')
  })

  it('does not call a criterion evaluated when this engine is blind to its rules', () => {
    // Contrast is the case the whole ENGINE_BLIND_RULES table exists for.
    const contrast = coverage.criteria.find((criterion) => criterion.number === '1.4.3')

    expect(contrast?.status).toBe('not-evaluated')
    expect(contrast?.browserWouldAnswer).toBe(true)
  })

  it('says a person is needed for a criterion no rule covers, whatever the engine', () => {
    // 2.4.3 Focus Order cannot be decided by any automated engine.
    const focusOrder = coverage.criteria.find((criterion) => criterion.number === '2.4.3')

    expect(focusOrder?.status).toBe('no-automated-rule')
    expect(focusOrder?.rules).toEqual([])
    expect(focusOrder?.browserWouldAnswer).toBe(false)
  })

  it('never claims a browser would answer a criterion no rule covers', () => {
    for (const criterion of coverage.criteria) {
      if (criterion.status === 'no-automated-rule') {
        expect(criterion.browserWouldAnswer, criterion.number).toBe(false)
      }
    }
  })

  it('counts nothing as evaluated for a run that audited nothing', () => {
    const empty = buildCoverage([])

    expect(empty.evaluated).toBe(0)
    expect(empty.total).toBe(WCAG22_AA_CRITERIA.length)
    // An empty run must not read as full coverage of the unautomatable ones
    // either: the count is a property of WCAG and axe-core, not of the run.
    expect(empty.noAutomatedRule).toBe(coverage.noAutomatedRule)
  })
})

describe('coverageSummary', () => {
  it('leads with what cannot be checked rather than with what was', () => {
    // Opening with a count of what was evaluated would read as a score, which
    // is precisely what this refuses to be.
    const summary = coverageSummary(coverage)

    expect(summary).toContain('cannot be checked by any automated engine')
    expect(summary.indexOf('cannot be checked')).toBeLessThan(summary.indexOf('reached a verdict'))
    expect(summary).not.toContain('%')
  })
})
