import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { collectPages } from '../../../src/audit/collect.ts'
import { formatConsoleReport } from '../../../src/audit/report/console.ts'
import { type PageAudit, runJsdomAudit } from '../../../src/audit/runners/jsdom.ts'

const SITE = fileURLToPath(new URL('../../fixtures/site', import.meta.url))

let audits: PageAudit[]
let report: string

function format(pages: readonly PageAudit[], width = 80): string {
  return formatConsoleReport(pages, { color: false, width })
}

beforeAll(async () => {
  audits = await runJsdomAudit(await collectPages(SITE))
  report = format(audits)
}, 60_000)

describe('formatConsoleReport', () => {
  it('lists each page and its violations', () => {
    expect(report).toContain('index.html')
    expect(report).toContain('image-alt')
    expect(report).toContain('link-name')
    expect(report).toContain('html-has-lang')
  })

  it('shows impact and success criteria next to the rule', () => {
    const line = lineContaining(report, 'image-alt')

    expect(line).toContain('critical')
    expect(line).toContain('WCAG 1.1.1')
  })

  it('points at the offending element', () => {
    expect(report).toContain('Images must have alternative text')
    expect(report).toContain('<img src="/assets/logo.svg">')
  })

  it('marks a clean page as clean', () => {
    expect(report).toMatch(/about\/index\.html\n {2}(✓|ok) no violations, \d+ rules evaluated/)
  })

  it('counts violations, pages and elements in the summary', () => {
    expect(report).toContain('Summary')
    expect(report).toContain('3 violations on 1 of 5 pages')
  })

  it('lists unevaluated rules once, not under every page', () => {
    expect(report).toContain('Not evaluated')
    expect(report).toContain('color-contrast')
    expect(report).toContain('needs rendered foreground and background colours')

    // Once in the summary section, never repeated per page.
    expect(occurrences(report, 'needs rendered foreground and background colours')).toBe(1)
  })

  it('never describes an unevaluated rule as passing', () => {
    const blindSection = report.slice(report.indexOf('Not evaluated'))

    expect(blindSection).toContain('never reported as passing')
    expect(blindSection).not.toMatch(/color-contrast.*pass/)
  })

  it('says how many pages each unevaluated rule affects', () => {
    expect(lineContaining(report, 'color-contrast')).toMatch(/\d+ pages?/)
  })
})

describe('narrow terminals', () => {
  it.each([40, 60, 80])('keeps every line within %i columns', (width) => {
    for (const line of format(audits, width).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(width)
    }
  })

  it('truncates a long element snippet rather than wrapping it', () => {
    const long = withViolationNode(
      'a'.repeat(400),
      Array.from({ length: 40 }, (_, index) => `.deeply .nested .selector-${index}`),
    )

    for (const line of format([long], 60).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(60)
    }
  })
})

describe('report edge cases', () => {
  it('reports a page that could not be audited', () => {
    const failed: PageAudit = {
      relativePath: 'broken.html',
      absolutePath: '/tmp/broken.html',
      url: 'file:///tmp/broken.html',
      engine: 'jsdom',
      violations: [],
      incomplete: [],
      passes: [],
      durationMs: 12,
      error: 'axe-core timed out after 30000ms',
    }

    const output = format([failed])

    expect(output).toContain('not audited: axe-core timed out after 30000ms')
    expect(output).toContain('1 page could not be audited')
  })

  it('summarises extra elements beyond the ones it shows', () => {
    const many = withViolationNode('<a href="#"></a>', ['a'], 7)

    expect(format([many])).toContain('+ 4 more elements')
  })

  it('handles an empty run', () => {
    expect(format([])).toContain('No violations across 0 pages')
  })
})

function withViolationNode(html: string, target: string[], count = 1): PageAudit {
  return {
    relativePath: 'page.html',
    absolutePath: '/tmp/page.html',
    url: 'file:///tmp/page.html',
    engine: 'jsdom',
    violations: [
      {
        ruleId: 'link-name',
        impact: 'serious',
        help: 'Links must have discernible text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/link-name',
        successCriteria: ['2.4.4', '4.1.2'],
        enClauses: ['9.2.4.4'],
        tags: ['wcag2a'],
        nodes: Array.from({ length: count }, () => ({ html, target })),
      },
    ],
    incomplete: [],
    passes: [],
    durationMs: 5,
  }
}

function lineContaining(text: string, needle: string): string {
  const line = text.split('\n').find((candidate) => candidate.includes(needle))
  if (!line) throw new Error(`no line containing ${needle}`)
  return line
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}
