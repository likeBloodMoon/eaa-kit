import type { ImpactValue } from 'axe-core'
import { describe, expect, it } from 'vitest'
import {
  countAtOrAbove,
  DEFAULT_FAIL_ON,
  IMPACT_LEVELS,
  type ImpactLevel,
  isImpactLevel,
  meetsThreshold,
} from '../../src/audit/impact.ts'
import type { Finding, PageAudit } from '../../src/audit/runners/jsdom.ts'

function finding(impact: ImpactValue): Finding {
  return {
    ruleId: `rule-${impact ?? 'unknown'}`,
    impact,
    help: 'Help text',
    helpUrl: 'https://example.test/rule',
    successCriteria: ['1.1.1'],
    enClauses: ['9.1.1.1'],
    tags: ['wcag2a'],
    nodes: [{ html: '<p></p>', target: ['p'] }],
  }
}

function auditWith(impacts: ImpactValue[]): PageAudit {
  return {
    relativePath: 'page.html',
    absolutePath: '/tmp/page.html',
    url: 'file:///tmp/page.html',
    engine: 'jsdom',
    violations: impacts.map(finding),
    incomplete: [],
    passes: [],
    inapplicable: [],
    durationMs: 1,
  }
}

describe('impact levels', () => {
  it('orders axe-core impacts least to most severe', () => {
    expect(IMPACT_LEVELS).toEqual(['minor', 'moderate', 'serious', 'critical'])
  })

  it('defaults to failing on serious', () => {
    expect(DEFAULT_FAIL_ON).toBe('serious')
  })

  it('recognises only the four axe-core levels', () => {
    for (const level of IMPACT_LEVELS) {
      expect(isImpactLevel(level)).toBe(true)
    }
    expect(isImpactLevel('blocker')).toBe(false)
    expect(isImpactLevel('SERIOUS')).toBe(false)
    expect(isImpactLevel('')).toBe(false)
  })
})

describe('meetsThreshold', () => {
  // The full matrix: rows are the violation's impact, columns the threshold.
  const expected: Record<ImpactLevel, Record<ImpactLevel, boolean>> = {
    minor: { minor: true, moderate: false, serious: false, critical: false },
    moderate: { minor: true, moderate: true, serious: false, critical: false },
    serious: { minor: true, moderate: true, serious: true, critical: false },
    critical: { minor: true, moderate: true, serious: true, critical: true },
  }

  for (const impact of IMPACT_LEVELS) {
    for (const threshold of IMPACT_LEVELS) {
      const want = expected[impact][threshold]
      it(`${impact} violation ${want ? 'fails' : 'passes'} --fail-on ${threshold}`, () => {
        expect(meetsThreshold(impact, threshold)).toBe(want)
      })
    }
  }

  it('counts an unclassified violation at every threshold', () => {
    // A missing impact is a gap in what we know, not evidence of harmlessness.
    for (const threshold of IMPACT_LEVELS) {
      expect(meetsThreshold(null, threshold)).toBe(true)
    }
  })

  it('counts an unrecognised impact at every threshold', () => {
    for (const threshold of IMPACT_LEVELS) {
      expect(meetsThreshold('catastrophic' as ImpactValue, threshold)).toBe(true)
    }
  })
})

describe('countAtOrAbove', () => {
  it('counts violations per rule across pages', () => {
    const audits = [auditWith(['critical', 'minor']), auditWith(['moderate'])]

    expect(countAtOrAbove(audits, 'minor')).toBe(3)
    expect(countAtOrAbove(audits, 'moderate')).toBe(2)
    expect(countAtOrAbove(audits, 'serious')).toBe(1)
    expect(countAtOrAbove(audits, 'critical')).toBe(1)
  })

  it('is zero when nothing reaches the threshold', () => {
    expect(countAtOrAbove([auditWith(['minor'])], 'serious')).toBe(0)
  })

  it('is zero for an empty run', () => {
    expect(countAtOrAbove([], 'minor')).toBe(0)
  })
})
