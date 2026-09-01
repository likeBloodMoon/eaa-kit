import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { collectPages } from '../../../src/audit/collect.ts'
import {
  type Collection,
  completeCollection,
  runCompleteness,
} from '../../../src/audit/completeness.ts'
import { formatConsoleReport } from '../../../src/audit/report/console.ts'
import { type PageAudit, runJsdomAudit } from '../../../src/audit/runners/jsdom.ts'

const SITE = fileURLToPath(new URL('../../fixtures/site', import.meta.url))

let audits: PageAudit[]
let report: string

/**
 * Most of this suite is about the per-page listing, which the report now prints
 * only when asked. The default view is covered by its own cases below.
 */
function format(pages: readonly PageAudit[], width = 80): string {
  return formatConsoleReport(pages, { color: false, width, perPage: true })
}

/** The report as somebody actually gets it: issues, no page-by-page listing. */
function formatDefault(pages: readonly PageAudit[], width = 80): string {
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
    expect(report).toMatch(/about\/index\.html\n {2}(✓|\+) no violations/)
  })

  it('separates what was checked from what had nothing to check', () => {
    const coverage = lineAfter(report, 'about/index.html', /passed/)

    expect(coverage).toMatch(/\d+ passed/)
    expect(coverage).toMatch(/\d+ not applicable/)
    // The two must never be added together into one "checked" figure.
    expect(coverage).not.toMatch(/\d+ rules evaluated/)
  })

  it('explains what not-applicable means, since it reads like good news', () => {
    expect(report).toContain('not applicable = nothing to check')
  })

  it('reports coverage for pages with violations too', () => {
    expect(lineAfter(report, 'index.html', /passed/)).toMatch(/\d+ passed · \d+ not applicable/)
  })

  it('counts unevaluated rules apart from applicable ones', () => {
    const coverage = lineAfter(report, 'index.html', /passed/)

    expect(coverage).toMatch(/\d+ not evaluated/)
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
      inapplicable: [],
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
    inapplicable: [],
    durationMs: 5,
  }
}

/** First line matching `pattern` at or after the line containing `anchor`. */
describe('the default view', () => {
  it('leads with the issues, not a roll call of pages', () => {
    const report = formatDefault(audits)

    // On a fifty-page site the page listing is a wall, and what somebody needs
    // first is what is broken rather than which pages are fine.
    expect(report).toContain('Issues')
    expect(report).not.toMatch(/^about\/index\.html$/m)
  })

  it('still names every page an element was found on', () => {
    // Dropping the listing must not drop the locations with it.
    expect(formatDefault(audits)).toMatch(/on \d+ pages?:/)
  })

  it('leaves out the per-page legend, which explains words it no longer prints', () => {
    expect(formatDefault(audits)).not.toContain('not applicable = nothing to check')
  })

  it('keeps the summary and the not-evaluated section', () => {
    const report = formatDefault(audits)

    expect(report).toContain('Summary')
    expect(report).toContain('Not evaluated')
  })

  it('adds the listing back when asked', () => {
    const report = formatConsoleReport(audits, { color: false, width: 80, perPage: true })

    expect(report).toMatch(/^about\/index\.html$/m)
    expect(report).toContain('not applicable = nothing to check')
  })
})

function lineAfter(text: string, anchor: string, pattern: RegExp): string {
  const lines = text.split('\n')
  // The page heading, which stands alone on its line — not the same path
  // mentioned inside the issues section above, which lists where each element
  // was found and would anchor this to the wrong part of the report.
  const start = lines.findIndex((line) => line.trimEnd() === anchor)
  if (start === -1) throw new Error(`no line that is exactly ${anchor}`)
  const found = lines.slice(start).find((line) => pattern.test(line))
  if (!found) throw new Error(`no line matching ${pattern} after ${anchor}`)
  return found
}

function lineContaining(text: string, needle: string): string {
  const line = text.split('\n').find((candidate) => candidate.includes(needle))
  if (!line) throw new Error(`no line containing ${needle}`)
  return line
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe('the completeness lines', () => {
  /** A clean page, so completeness is the only thing shaping the summary. */
  function clean(): PageAudit {
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
    }
  }

  function summaryOf(overrides: Partial<Collection>): string {
    const pages = [clean()]
    return formatConsoleReport(pages, {
      color: false,
      width: 80,
      completeness: runCompleteness(pages, {
        discovery: 'links',
        collected: 1,
        unreachable: [],
        truncated: false,
        ...overrides,
      }),
    })
  }

  it('says nothing extra when the run reached everything', () => {
    const pages = [clean()]
    const report = formatConsoleReport(pages, {
      color: false,
      width: 80,
      completeness: runCompleteness(pages, completeCollection('directory', 1)),
    })

    expect(report).toContain('No violations across 1 page.')
    expect(report).not.toContain('not the whole site')
  })

  it('qualifies a clean result when the run stopped at its page limit', () => {
    const report = summaryOf({ truncated: true })

    expect(report).toContain('stopped at its page limit')
    expect(report).toContain('No violations across the 1 page that were audited.')
    expect(report).toContain('not the whole site')
  })

  it('counts the pages it could not reach', () => {
    const report = summaryOf({
      unreachable: [
        { location: '/a', reason: '404' },
        { location: '/b', reason: '404' },
      ],
    })

    expect(report).toContain('2 pages could not be reached')
  })

  it('counts one unreachable page in the singular', () => {
    const report = summaryOf({ unreachable: [{ location: '/a', reason: '404' }] })

    expect(report).toContain('1 page could not be reached, and was not audited')
  })

  it('does not count an errored page among the pages it found nothing on', () => {
    // "No violations across 2 pages" over a run where one page could not be
    // read hands back a verdict on markup nothing opened. The count is of what
    // was audited; the error line beneath it says what was not.
    const pages = [clean(), { ...clean(), relativePath: 'broken.html', error: 'boom' }]

    const report = formatConsoleReport(pages, {
      color: false,
      width: 80,
      completeness: runCompleteness(pages, completeCollection('directory', 2)),
    })

    expect(report).toContain('No violations across the 1 page that were audited.')
    expect(report).not.toContain('No violations across 2 pages')
  })

  it('refuses to call a run clean when every page failed', () => {
    // The shape `audit --browser` produced when it navigated to a filesystem
    // path instead of a URL: every page errored, nothing was read, and the
    // summary opened with "No violations" in green.
    const pages = [
      { ...clean(), relativePath: 'a.html', error: 'boom' },
      { ...clean(), relativePath: 'b.html', error: 'boom' },
    ]

    const report = formatConsoleReport(pages, { color: false, width: 80 })

    expect(report).toContain('Nothing was audited: no page could be read.')
    expect(report).not.toContain('No violations')
    expect(report).toContain('2 pages could not be audited')
  })

  it('leaves the errored count to the summary rather than double-reporting it', () => {
    const pages = [clean(), { ...clean(), relativePath: 'broken.html', error: 'boom' }]
    const report = formatConsoleReport(pages, {
      color: false,
      width: 80,
      completeness: runCompleteness(pages, completeCollection('directory', 2)),
    })

    // Once, from the summary's own line — not again from the completeness block.
    expect(report.match(/could not be audited/g)).toHaveLength(1)
  })
})

describe('the coverage lines', () => {
  /** The summary is wrapped to the terminal, so match it as words. */
  const flat = (printed: string): string => printed.replace(/\s+/g, ' ')

  it('prints the one-line summary by default', () => {
    const printed = formatDefault(audits)

    expect(flat(printed)).toContain('WCAG 2.2 A and AA success criteria')
    expect(flat(printed)).toContain('cannot be checked by any automated engine')
    expect(printed).toContain('Run with --coverage')
  })

  it('lists every criterion with --coverage', () => {
    const printed = formatConsoleReport(audits, { color: false, width: 100, coverage: true })

    expect(printed).toContain('Coverage')
    expect(printed).toContain('1.1.1 Non-text Content')
    expect(printed).toContain('no automated rule exists; a person must check it')
    expect(printed).not.toContain('Run with --coverage')
  })

  it('never prints a percentage', () => {
    expect(formatConsoleReport(audits, { color: false, width: 100, coverage: true })).not.toMatch(
      /\d+\s*%/,
    )
  })
})
