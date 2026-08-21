import type { AxeResults, Result } from 'axe-core'
import { describe, expect, it } from 'vitest'
import { type BlindRule, shapeResults } from '../../src/audit/result.ts'

function rule(id: string, overrides: Partial<Result> = {}): Result {
  return {
    id,
    impact: 'serious',
    description: `${id} description`,
    help: `${id} help`,
    helpUrl: `https://example.test/${id}`,
    tags: ['wcag2aa', 'wcag143', 'EN-301-549', 'EN-9.1.4.3'],
    nodes: [],
    ...overrides,
  } as Result
}

function results(overrides: Partial<AxeResults> = {}): AxeResults {
  return {
    violations: [],
    passes: [],
    incomplete: [],
    inapplicable: [],
    ...overrides,
  } as AxeResults
}

const identity = {
  relativePath: 'index.html',
  absolutePath: '/tmp/index.html',
  url: 'file:///tmp/index.html',
  engine: 'browser' as const,
  durationMs: 1,
}

function shape(raw: AxeResults, blind: Map<string, BlindRule> = new Map()) {
  return shapeResults(raw, { ...identity, blind })
}

describe('bucket precedence', () => {
  it('does not count a rule as passing when it also failed', () => {
    // axe-core reports a rule in both arrays when it fails on one element and
    // passes on another. Observed with colour contrast in a real browser run:
    // one bad paragraph on a page of good ones.
    const audit = shape(
      results({ violations: [rule('color-contrast')], passes: [rule('color-contrast')] }),
    )

    expect(audit.violations.map((finding) => finding.ruleId)).toEqual(['color-contrast'])
    expect(audit.passes).toEqual([])
  })

  it('prefers a violation over an incomplete for the same rule', () => {
    const audit = shape(
      results({ violations: [rule('color-contrast')], incomplete: [rule('color-contrast')] }),
    )

    expect(audit.violations).toHaveLength(1)
    expect(audit.incomplete).toEqual([])
  })

  it('prefers an incomplete over a pass for the same rule', () => {
    const audit = shape(results({ incomplete: [rule('bypass')], passes: [rule('bypass')] }))

    expect(audit.incomplete.map((finding) => finding.ruleId)).toEqual(['bypass'])
    expect(audit.passes).toEqual([])
  })

  it('never files a rule as inapplicable once it has a verdict', () => {
    const audit = shape(results({ passes: [rule('image-alt')], inapplicable: [rule('image-alt')] }))

    expect(audit.passes).toHaveLength(1)
    expect(audit.inapplicable).toEqual([])
  })

  it('keeps every rule in exactly one bucket', () => {
    const audit = shape(
      results({
        violations: [rule('color-contrast'), rule('image-alt')],
        passes: [rule('color-contrast'), rule('document-title')],
        incomplete: [rule('image-alt'), rule('bypass')],
        inapplicable: [rule('bypass'), rule('label')],
      }),
    )

    const all = [
      ...audit.violations.map((finding) => finding.ruleId),
      ...audit.incomplete.map((finding) => finding.ruleId),
      ...audit.passes.map((outcome) => outcome.ruleId),
      ...audit.inapplicable.map((outcome) => outcome.ruleId),
    ]

    expect(all.length).toBe(new Set(all).size)
    expect(new Set(all)).toEqual(
      new Set(['color-contrast', 'image-alt', 'document-title', 'bypass', 'label']),
    )
  })
})

describe('blind rules', () => {
  const blind = new Map<string, BlindRule>([
    ['color-contrast', { detail: 'needs rendered colours', applicabilityUnreliable: false }],
  ])

  it('downgrades a blind rule that axe-core passed', () => {
    const audit = shape(results({ passes: [rule('color-contrast')] }), blind)

    expect(audit.passes).toEqual([])
    expect(audit.incomplete[0]).toMatchObject({
      ruleId: 'color-contrast',
      reason: 'engine-limitation',
      reasonDetail: 'needs rendered colours',
    })
  })

  it('keeps every verdict when nothing is blind, which is browser mode', () => {
    const audit = shape(results({ violations: [rule('color-contrast')] }))

    expect(audit.violations.map((finding) => finding.ruleId)).toEqual(['color-contrast'])
    expect(audit.incomplete).toEqual([])
  })

  it('carries the standards mapping through', () => {
    const audit = shape(results({ violations: [rule('color-contrast')] }))

    expect(audit.violations[0]?.successCriteria).toEqual(['1.4.3'])
    expect(audit.violations[0]?.enClauses).toEqual(['9.1.4.3'])
  })
})
