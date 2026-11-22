import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { collectPages } from '../../../src/audit/collect.ts'
import { completeCollection, runCompleteness } from '../../../src/audit/completeness.ts'
import { buildMarkdownReport } from '../../../src/audit/report/markdown.ts'
import { type PageAudit, runJsdomAudit } from '../../../src/audit/runners/jsdom.ts'
import { TOOL_VERSION } from '../../../src/version.ts'

const SITE = fileURLToPath(new URL('../../fixtures/site', import.meta.url))

let audits: PageAudit[]

function build(pages: readonly PageAudit[] = audits, overrides = {}): string {
  return buildMarkdownReport(pages, { directory: './dist', failOn: 'serious', ...overrides })
}

function blank(overrides: Partial<PageAudit> = {}): PageAudit {
  return {
    relativePath: 'index.html',
    absolutePath: '/dist/index.html',
    url: 'file:///dist/index.html',
    engine: 'jsdom',
    violations: [],
    incomplete: [],
    passes: [],
    inapplicable: [],
    durationMs: 1,
    ...overrides,
  }
}

function finding(overrides = {}) {
  return {
    ruleId: 'image-alt',
    help: 'Images must have alternative text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/image-alt',
    successCriteria: ['1.1.1'],
    enClauses: ['9.1.1.1'],
    tags: [],
    impact: 'critical' as const,
    nodes: [{ html: '<img src="/logo.svg">', target: ['img'] }],
    ...overrides,
  }
}

/** The data rows of the counts table, as label → value. */
function counts(markdown: string): Map<string, string> {
  const rows = new Map<string, string>()
  for (const line of markdown.split('\n')) {
    const match = /^\| ([^|]+?) \| (\d+) \|$/.exec(line)
    if (match?.[1] && match[2]) rows.set(match[1], match[2])
  }
  return rows
}

beforeAll(async () => {
  audits = await runJsdomAudit(await collectPages(SITE))
}, 60_000)

describe('the markdown summary', () => {
  it('leads with a heading and the verdict', () => {
    const lines = build().split('\n')

    expect(lines[0]).toBe('## Accessibility audit')
    expect(lines[2]).toMatch(/^\*\*/)
  })

  it('agrees with the fixture site about what fails', () => {
    const markdown = build()
    const failing = audits.reduce(
      (total, audit) =>
        total +
        audit.violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious' || !v.impact,
        ).length,
      0,
    )

    expect(failing).toBeGreaterThan(0)
    expect(counts(markdown).get('Violations at or above serious')).toBe(String(failing))
    expect(markdown).toContain('### Barriers that fail the run')
  })

  it('says a clean run is clean without calling it compliant', () => {
    const markdown = build([blank()])

    expect(markdown).toContain('**No violations found** at or above serious.')
    expect(markdown).not.toContain('### Barriers')
    expect(markdown).toContain('This is not a conformance claim.')
    expect(markdown).not.toMatch(/\bcompliant\b|\bpasses WCAG\b/i)
  })

  it('lists a failing rule with its criterion, element count and pages', () => {
    const markdown = build([
      blank({ relativePath: 'a.html', violations: [finding()] }),
      blank({ relativePath: 'b.html', violations: [finding()] }),
    ])

    expect(markdown).toContain(
      '| critical | [`image-alt`](https://dequeuniversity.com/rules/axe/4.13/image-alt) Images must have alternative text | 1.1.1 | 1 | `a.html`, `b.html` |',
    )
    expect(markdown).toContain('**2 violations** at or above serious, across 1 rule.')
  })

  it('keeps violations below the threshold out of the failing list but counts them', () => {
    const markdown = build([blank({ violations: [finding({ impact: 'minor' })] })])

    expect(markdown).toContain('**No violations found**')
    expect(counts(markdown).get('Violations below serious, not failing')).toBe('1')
    expect(markdown).not.toContain('### Barriers')
  })

  it('fails an unclassified violation, as --fail-on does', () => {
    const markdown = build([blank({ violations: [finding({ impact: null })] })], {
      failOn: 'critical',
    })

    expect(markdown).toContain('| unclassified |')
    expect(counts(markdown).get('Violations at or above critical')).toBe('1')
  })

  it('separates what a change introduced from what a baseline accepts', () => {
    const markdown = build(
      [blank({ violations: [finding()], accepted: [finding({ ruleId: 'label' })] })],
      { baseline: { stale: 2, expired: 1 } },
    )
    const rows = counts(markdown)

    expect(markdown).toContain('**1 new violation**')
    expect(markdown).toContain('### New barriers')
    expect(rows.get('New violations at or above serious')).toBe('1')
    expect(rows.get('Elements the baseline accepts')).toBe('1')
    expect(rows.get('Baseline entries now fixed or gone')).toBe('2')
    expect(rows.get('Baseline entries expired')).toBe('1')
  })

  it('says "no new violations" when a baseline accepts everything', () => {
    const markdown = build([blank({ accepted: [finding()] })], {
      baseline: { stale: 0, expired: 0 },
    })

    expect(markdown).toContain('**No new violations found**')
    expect(markdown).not.toContain('fixed or gone')
  })

  it('names rules the engine could not evaluate instead of passing them', () => {
    const markdown = build([
      blank({
        incomplete: [
          {
            ...finding({ ruleId: 'color-contrast', impact: 'serious' }),
            reason: 'engine-limitation',
            reasonDetail: 'needs layout',
          },
        ],
      }),
    ])

    expect(counts(markdown).get('Rules this engine could not evaluate')).toBe('1')
    expect(markdown).toContain('### Not checked by this run')
    expect(markdown).toContain('They are not counted as passes.')
  })

  it('reaches no verdict when a page could not be audited', () => {
    const markdown = build([blank(), blank({ relativePath: 'broken.html', error: 'timeout' })])

    expect(markdown).toContain('**Could not finish.**')
    expect(counts(markdown).get('Pages that could not be audited')).toBe('1')
    expect(counts(markdown).get('Pages audited')).toBe('1')
  })

  it('qualifies a clean result over part of a site', () => {
    const pages = [blank()]
    const completeness = runCompleteness(pages, {
      ...completeCollection('links', 1),
      truncated: true,
    })
    const markdown = build(pages, { completeness })

    expect(completeness.complete).toBe(false)
    expect(markdown).toContain('but the whole site was not measured')
  })

  it('bounds a run with hundreds of failing rules and pages', () => {
    const many = Array.from({ length: 300 }, (_, index) =>
      blank({
        relativePath: `page-${index}.html`,
        violations: Array.from({ length: 40 }, (_, rule) =>
          finding({ ruleId: `rule-${rule}`, help: `Rule ${rule}` }),
        ),
      }),
    )
    const markdown = build(many)

    // GitHub's limit for a pull request comment.
    expect(markdown.length).toBeLessThan(65_536)
    expect(markdown).toContain('15 more rules not listed')
    expect(markdown).toContain('and 297 more')
  })

  it('escapes text that would break the table', () => {
    const markdown = build([
      blank({
        relativePath: 'we|ird`page.html',
        violations: [finding({ help: 'A | pipe and\na newline <b>and tags</b>' })],
      }),
    ])
    const row = markdown.split('\n').find((line) => line.startsWith('| critical'))

    expect(row).toBeDefined()
    expect(row).toContain('A \\| pipe and a newline \\<b\\>and tags\\</b\\>')
    expect(row).toContain("`we\\|ird'page.html`")
    // Six cells: the separators that are not escaped.
    expect(row?.split(/(?<!\\)\|/).length).toBe(7)
  })

  it('carries the version and what was audited', () => {
    expect(build()).toContain(`eaa-kit ${TOOL_VERSION} · ./dist`)
  })
})
