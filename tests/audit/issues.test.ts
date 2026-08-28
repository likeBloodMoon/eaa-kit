import { describe, expect, it } from 'vitest'
import { groupIssues, isShared, SHARED_COMPONENT_THRESHOLD } from '../../src/audit/issues.ts'
import type { Finding, PageAudit } from '../../src/audit/result.ts'

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'image-alt',
    help: 'Images must have alternative text',
    helpUrl: 'https://example.test/image-alt',
    successCriteria: ['1.1.1'],
    enClauses: ['9.1.1.1'],
    tags: [],
    impact: 'critical',
    nodes: [{ html: '<img src="/logo.png">', target: ['img'] }],
    ...overrides,
  }
}

function page(relativePath: string, violations: Finding[]): PageAudit {
  return {
    relativePath,
    absolutePath: `/site/${relativePath}`,
    url: `file:///site/${relativePath}`,
    engine: 'jsdom',
    violations,
    incomplete: [],
    passes: [],
    inapplicable: [],
    durationMs: 1,
  }
}

describe('groupIssues', () => {
  it('folds one element repeated across pages into a single entry', () => {
    // The whole point: a broken header on four pages is one line in one file,
    // and a page-by-page report never says so.
    const issues = groupIssues([
      page('index.html', [finding()]),
      page('a.html', [finding()]),
      page('b.html', [finding()]),
    ])

    expect(issues).toHaveLength(1)
    expect(issues[0]?.elements).toHaveLength(1)
    expect(issues[0]?.elements[0]?.pages).toEqual(['a.html', 'b.html', 'index.html'])
    expect(issues[0]?.occurrences).toBe(3)
  })

  it('keeps genuinely different elements apart', () => {
    const issues = groupIssues([
      page('a.html', [finding({ nodes: [{ html: '<img src="/one.png">', target: ['img'] }] })]),
      page('b.html', [finding({ nodes: [{ html: '<img src="/two.png">', target: ['img'] }] })]),
    ])

    expect(issues[0]?.elements).toHaveLength(2)
  })

  it('counts every failing element, not every page', () => {
    const issues = groupIssues([
      page('a.html', [
        finding({
          nodes: [
            { html: '<img src="/one.png">', target: ['img:nth-child(1)'] },
            { html: '<img src="/two.png">', target: ['img:nth-child(2)'] },
          ],
        }),
      ]),
    ])

    expect(issues[0]?.occurrences).toBe(2)
    expect(issues[0]?.pages).toEqual(['a.html'])
  })

  it('orders rules by severity, then by how far they reach', () => {
    const issues = groupIssues([
      page('a.html', [
        finding({ ruleId: 'mild', impact: 'minor' }),
        finding({ ruleId: 'bad', impact: 'critical' }),
      ]),
    ])

    expect(issues.map((issue) => issue.ruleId)).toEqual(['bad', 'mild'])
  })

  it('sorts an unclassified impact with the most severe', () => {
    // Same reasoning as --fail-on: not knowing how bad something is is not
    // evidence that it is mild.
    const issues = groupIssues([
      page('a.html', [
        finding({ ruleId: 'known', impact: 'critical' }),
        finding({ ruleId: 'unknown', impact: null }),
      ]),
    ])

    expect(issues[0]?.ruleId).toBe('unknown')
  })

  it('puts the most widespread element first within a rule', () => {
    const wide = { html: '<a href="/a"></a>', target: ['a.wide'] }
    const narrow = { html: '<a href="/b"></a>', target: ['a.narrow'] }
    const issues = groupIssues([
      page('a.html', [finding({ ruleId: 'link-name', nodes: [wide, narrow] })]),
      page('b.html', [finding({ ruleId: 'link-name', nodes: [wide] })]),
    ])

    expect(issues[0]?.elements[0]?.selector).toBe('a.wide')
  })

  it('gives a rule that failed with no element an identity of its own', () => {
    const issues = groupIssues([page('a.html', [finding({ ruleId: 'html-has-lang', nodes: [] })])])

    expect(issues[0]?.elements).toHaveLength(1)
    expect(issues[0]?.occurrences).toBe(1)
  })

  it('produces nothing from a clean run', () => {
    expect(groupIssues([page('a.html', [])])).toEqual([])
  })

  it('is stable across two runs of the same audit', () => {
    const audits = [page('b.html', [finding()]), page('a.html', [finding()])]

    expect(JSON.stringify(groupIssues(audits))).toBe(JSON.stringify(groupIssues(audits)))
  })
})

describe('isShared', () => {
  it.each([
    [1, false],
    [2, false],
    [SHARED_COMPONENT_THRESHOLD, true],
    [10, true],
  ])('on %i pages -> %s', (count, expected) => {
    const pages = Array.from({ length: count }, (_, i) => `p${i}.html`)

    expect(isShared({ fingerprint: 'x', selector: 'img', html: '<img>', pages })).toBe(expected)
  })
})
