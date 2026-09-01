import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { collectPages } from '../../../src/audit/collect.ts'
import {
  type Collection,
  completeCollection,
  runCompleteness,
} from '../../../src/audit/completeness.ts'
import { buildHtmlReport } from '../../../src/audit/report/html.ts'
import { auditPage, type PageAudit, runJsdomAudit } from '../../../src/audit/runners/jsdom.ts'

const SITE = fileURLToPath(new URL('../../fixtures/site', import.meta.url))
const NOW = new Date('2026-08-20T18:00:00.000Z')

let audits: PageAudit[]
let report: string

function build(pages: readonly PageAudit[] = audits, overrides = {}): string {
  return buildHtmlReport(pages, {
    directory: './dist',
    failOn: 'serious',
    now: NOW,
    ...overrides,
  })
}

/** A page result with nothing on it, to bolt specific findings onto. */
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

/** The text a reader sees, with the markup taken out. */
function text(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
}

beforeAll(async () => {
  audits = await runJsdomAudit(await collectPages(SITE))
  report = build()
}, 60_000)

describe('the document', () => {
  it('is a complete, self-contained page', () => {
    expect(report.startsWith('<!doctype html>')).toBe(true)
    expect(report.trimEnd().endsWith('</html>')).toBe(true)
    expect(report).toContain('<html lang="en">')
    expect(report).toContain('<main>')
  })

  it('has no scripts and fetches nothing', () => {
    // It is opened from an email attachment, and it is a report about somebody
    // else's markup. It has no business making requests or running anything.
    expect(report).not.toMatch(/<script/i)
    expect(report).not.toMatch(/<link\b/i)
    expect(report).not.toMatch(/<img\b/i)
    expect(report).not.toMatch(/\bon[a-z]+=/i)
  })

  it('names what was audited in the title', () => {
    expect(report).toContain('<title>Accessibility audit · ./dist</title>')
  })

  it('is the same document twice for the same run', () => {
    // The JSON report makes this promise and this one keeps it too: two reports
    // of the same build should diff cleanly.
    expect(build()).toBe(report)
  })

  it('records the run, the engine and the versions', () => {
    const readable = text(report)

    expect(readable).toContain('./dist')
    expect(readable).toContain('jsdom (browserless)')
    expect(readable).toContain('2026-08-20T18:00:00.000Z')
    expect(readable).toContain('axe-core')
  })

  it('names the base URL only when the run used one', () => {
    expect(text(report)).not.toContain('Base URL')
    expect(text(build(audits, { baseUrl: 'https://example.at' }))).toContain('https://example.at')
  })

  it('calls a Chromium run Chromium', () => {
    const browser = build([blank({ engine: 'browser' })])

    expect(text(browser)).toContain('Chromium')
    expect(text(browser)).not.toContain('browserless')
  })
})

describe('the verdict', () => {
  it('leads with the failure when something fails the threshold', () => {
    expect(text(report)).toContain('Violations found 3 violations at or above serious')
  })

  it('says so when nothing was found at all', () => {
    expect(text(build([blank()]))).toContain('No violations found')
  })

  it('distinguishes violations that do not meet the threshold', () => {
    // Passing the run is not the same as having nothing wrong, and a reader who
    // only reads the banner should still learn that.
    const minor = build([blank({ violations: [finding({ impact: 'minor' })] })])

    expect(text(minor)).toContain('No violations at the threshold')
    expect(text(minor)).toContain('1 violation below serious')
  })

  it('reports a run that could not finish as neither pass nor fail', () => {
    const broken = build([blank({ error: 'could not be parsed' })])

    expect(text(broken)).toContain('Could not finish')
    expect(text(broken)).toContain('reached no verdict')
  })

  it('never conveys the outcome by colour alone', () => {
    // The word is in the banner, not just the border colour.
    expect(report).toMatch(/class="verdict fail"[\s\S]*?Violations found/)
  })
})

describe('the summary', () => {
  it('counts violations, pages and elements', () => {
    expect(text(report)).toContain('3 violations on 1 of 5 pages, across 3 elements')
  })

  it('breaks the violations down by impact', () => {
    expect(report).toContain('<span class="badge critical">critical</span> 1')
    expect(report).toContain('<span class="badge serious">serious</span> 2')
  })

  it('keeps passes and inapplicable apart, and says why', () => {
    const readable = text(report)

    expect(readable).toContain('checked and met')
    expect(readable).toContain('found nothing on the page to check')
    expect(readable).toContain('never added together')
  })

  it('counts what needs a human and what the engine could not decide', () => {
    const readable = text(report)

    expect(readable).toContain('1 rule needs manual review')
    expect(readable).toContain('21 rules were not evaluated by this engine')
  })
})

describe('a page', () => {
  it('says plainly when it has no violations', () => {
    expect(text(report)).toContain('about/index.html No violations.')
  })

  it('lists what it rests on, without summing the categories', () => {
    expect(text(report)).toContain('6 passed · 53 not applicable · 4 not evaluated')
  })

  it('gives each violation its rule, impact, help link and standards', () => {
    const readable = text(report)

    expect(readable).toContain('image-alt')
    expect(readable).toContain('Images must have alternative text')
    expect(readable).toContain('WCAG 1.1.1, EN 301 549 9.1.1.1')
    expect(report).toContain('href="https://dequeuniversity.com/rules/axe/4.13/image-alt')
  })

  it('orders violations worst first', () => {
    const page = build([
      blank({
        violations: [
          finding({ ruleId: 'b-minor', impact: 'minor' }),
          finding({ ruleId: 'a-critical', impact: 'critical' }),
          finding({ ruleId: 'c-serious', impact: 'serious' }),
        ],
      }),
    ])
    const order = ['a-critical', 'c-serious', 'b-minor'].map((id) => page.indexOf(`>${id}<`))

    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('sorts an unclassified impact with the most severe', () => {
    // Same reasoning as --fail-on: not knowing how bad a barrier is is not
    // evidence that it is mild.
    const page = build([
      blank({
        violations: [
          finding({ ruleId: 'known', impact: 'critical' }),
          finding({ ruleId: 'unknown', impact: null }),
        ],
      }),
    ])

    expect(page.indexOf('>unknown<')).toBeLessThan(page.indexOf('>known<'))
  })

  it('says what a rule maps to, or that it maps to nothing', () => {
    const page = build([blank({ violations: [finding({ successCriteria: [], enClauses: [] })] })])

    expect(text(page)).toContain('No mapped success criterion')
  })

  it('lists the rules a human still has to decide', () => {
    expect(text(report)).toContain('bypass needs manual review')
  })

  it('reports a page it could not audit rather than leaving it out', () => {
    const broken = build([blank({ error: 'jsdom gave up' })])

    expect(text(broken)).toContain('Not audited jsdom gave up')
  })
})

describe('the offending elements', () => {
  it('shows the selector and the markup', () => {
    const readable = text(report)

    expect(readable).toContain('img')
    expect(report).toContain('&lt;img src="/assets/logo.svg"&gt;')
  })

  it('escapes the markup it quotes', () => {
    // This is the one place the report embeds arbitrary HTML from somebody
    // else's build. A page that fails an audit for carrying a stray script
    // must not hand that script to whoever opens the report.
    const page = build([
      blank({
        violations: [
          finding({
            nodes: [{ html: '<script>alert(1)</script>', target: ['script'] }],
          }),
        ],
      }),
    ])

    expect(page).not.toContain('<script>alert(1)</script>')
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes a selector too', () => {
    const page = build([
      blank({
        violations: [finding({ nodes: [{ html: '<b>x</b>', target: ['a[title="<x>"]'] }] })],
      }),
    ])

    // A selector is text content, so the angle brackets have to go and the
    // quotes may stay: nothing between tags can be closed by a quote.
    expect(page).toContain('a[title="&lt;x&gt;"]')
    expect(page).not.toContain('a[title="<x>"]')
  })

  it('caps how many it lists, and counts the rest', () => {
    const nodes = Array.from({ length: 9 }, (_, index) => ({
      html: `<img src="/${index}.png">`,
      target: [`img:nth-child(${index})`],
    }))
    const page = build([blank({ violations: [finding({ nodes })] })])

    expect(text(page)).toContain('and 4 more elements')
    expect(page).toContain('/4.png')
    expect(page).not.toContain('/5.png')
  })

  it('collapses and truncates a long snippet, so one minified page cannot fill the report', () => {
    const page = build([
      blank({
        violations: [
          finding({ nodes: [{ html: `<div>\n  ${'x'.repeat(500)}\n</div>`, target: ['div'] }] }),
        ],
      }),
    ])

    expect(page).toContain('…')
    expect(page).not.toContain('x'.repeat(300))
  })
})

describe('what was not evaluated', () => {
  it('names each rule, how many pages, and why', () => {
    const readable = text(report)

    expect(readable).toContain('never reported as passing')
    expect(readable).toContain('color-contrast on 5 pages')
    expect(readable).toContain('needs rendered foreground and background colours')
  })

  it('leaves the section out when there is nothing in it', () => {
    expect(text(build([blank()]))).not.toContain('Not evaluated')
  })
})

describe('the footer', () => {
  it('refuses to let a clean report read as a compliance statement', () => {
    const readable = text(build([blank()]))

    expect(readable).toContain('not a compliance statement')
    expect(readable).toContain('minority of accessibility barriers')
  })
})

describe('the report itself', () => {
  it('has no accessibility violations', async () => {
    // A tool that emits an inaccessible accessibility report has failed at the
    // one job it has. Audited with the engine the audit command uses.
    const audit = await auditPage({
      absolutePath: '/report.html',
      relativePath: 'report.html',
      html: report,
    })

    expect(audit.error).toBeUndefined()
    expect(audit.violations).toEqual([])
  })

  it('has no accessibility violations when it is reporting a broken run either', async () => {
    const audit = await auditPage({
      absolutePath: '/report.html',
      relativePath: 'report.html',
      html: build([blank({ error: 'jsdom gave up' }), blank({ violations: [finding()] })]),
    })

    expect(audit.violations).toEqual([])
  })
})

describe('the scoreboard and issues sections', () => {
  it('leads with the counts by severity', () => {
    const page = build([blank({ violations: [finding({ impact: 'critical' })] })])

    expect(page).toContain('class="tile critical"')
    expect(text(page)).toMatch(/1\s+critical/)
  })

  it('shows what was never evaluated in the same row as the violations', () => {
    // The one place this document could mislead. "0 critical, 0 serious" reads
    // as a clean site when the honest reading may be that six whole categories
    // could not be checked, so the number sits in the same block rather than in
    // a section nobody scrolls to.
    const page = build([
      blank({
        incomplete: [
          {
            ...finding({ ruleId: 'color-contrast' }),
            reason: 'engine-limitation' as const,
            reasonDetail: 'needs rendered colours',
          },
        ],
      }),
    ])

    expect(page).toContain('class="tile unchecked"')
    expect(text(page)).toMatch(/1\s+not evaluated/)
  })

  it('folds one element across pages into a single issue', () => {
    const shared = finding({ nodes: [{ html: '<img src="/logo.png">', target: ['img'] }] })
    const page = build([
      blank({ relativePath: 'a.html', violations: [shared] }),
      blank({ relativePath: 'b.html', violations: [shared] }),
      blank({ relativePath: 'c.html', violations: [shared] }),
    ])

    expect(text(page)).toContain('Found on 3 pages')
    expect(text(page)).toContain('likely one shared component')
  })

  it('does not call two pages a shared component', () => {
    const shared = finding({ nodes: [{ html: '<img src="/logo.png">', target: ['img'] }] })
    const page = build([
      blank({ relativePath: 'a.html', violations: [shared] }),
      blank({ relativePath: 'b.html', violations: [shared] }),
    ])

    expect(text(page)).not.toContain('likely one shared component')
  })

  it('names the source file when one is known', () => {
    const page = buildHtmlReport([blank({ relativePath: 'index.html', violations: [finding()] })], {
      directory: './dist',
      failOn: 'serious',
      now: NOW,
      sourceFor: (path) => (path === 'index.html' ? 'app/page.tsx' : undefined),
    })

    expect(text(page)).toContain('app/page.tsx')
  })

  it('caps the elements shown per issue', () => {
    const nodes = Array.from({ length: 9 }, (_, index) => ({
      html: `<img src="/x${index}.png">`,
      target: [`img:nth-child(${index})`],
    }))
    const page = build([blank({ violations: [finding({ nodes })] })])

    expect(text(page)).toContain('and 4 more elements')
  })
})

describe('what the run did not measure', () => {
  /** A clean page, so the only thing deciding the verdict is completeness. */
  const clean = [blank()]

  function partial(overrides: Partial<Collection>): string {
    return build(clean, {
      completeness: runCompleteness(clean, {
        discovery: 'links',
        collected: 1,
        unreachable: [],
        truncated: false,
        ...overrides,
      }),
    })
  }

  it('gives a clean, complete run the plain pass banner', () => {
    const html = build(clean, {
      completeness: runCompleteness(clean, completeCollection('directory', 1)),
    })

    expect(html).toContain('class="verdict pass"')
    expect(text(html)).toContain('No violations found')
    expect(html).not.toContain('class="verdict partial"')
    expect(html).not.toContain('What this run did not measure')
  })

  it('refuses the plain pass banner when the whole site was not measured', () => {
    // The bug this exists to prevent: a crawl that reached a fraction of a site
    // and found nothing used to render exactly like a complete clean run.
    const html = partial({ truncated: true })

    expect(html).toContain('class="verdict partial"')
    expect(html).not.toContain('class="verdict pass"')
    expect(text(html)).toContain('the whole site was not measured')
  })

  it('names the pages it could not reach, with the reason for each', () => {
    const html = partial({
      unreachable: [
        { location: 'https://example.com/pricing', reason: 'HTTP 404' },
        { location: 'https://example.com/team', reason: 'timed out' },
      ],
    })

    const readable = text(html)
    expect(readable).toContain('https://example.com/pricing')
    expect(readable).toContain('HTTP 404')
    expect(readable).toContain('https://example.com/team')
    expect(readable).toContain('timed out')
  })

  it('says how the pages were found', () => {
    expect(text(partial({ discovery: 'sitemap', truncated: true }))).toContain(
      'sitemap.xml and links',
    )
  })

  it('says nothing about completeness when it was not given any', () => {
    // A caller rendering a report by hand gets the document it always got,
    // rather than a claim that the run was complete.
    const html = build(clean)

    expect(html).not.toContain('What this run did not measure')
    expect(html).not.toContain('class="verdict partial"')
  })
})

describe('the coverage section', () => {
  it('leads with what cannot be automated rather than with what passed', () => {
    const readable = text(report)

    expect(readable).toContain('Coverage of WCAG 2.2 AA')
    expect(readable).toContain('cannot be checked by any automated engine')
  })

  it('never turns the four counts into a score', () => {
    // A percentage here would present a limit of automated testing as though it
    // were a measurement of this site.
    const section = report.slice(report.indexOf('Coverage of WCAG 2.2 AA'))

    expect(section).not.toMatch(/\d+\s*%/)
    expect(section).toContain('never added together or divided into a score')
  })

  it('lists all 55 criteria with somewhere to read what each requires', () => {
    const section = report.slice(report.indexOf('Coverage of WCAG 2.2 AA'))
    const rows = section.match(/<tr class="/g) ?? []

    expect(rows).toHaveLength(55)
    expect(section).toContain('https://www.w3.org/WAI/WCAG22/Understanding/')
  })

  it('says which criteria a real browser would answer', () => {
    expect(text(report)).toContain('a real browser would answer')
  })

  it('keeps the wide table inside its own scroll container', () => {
    // The page body must never scroll sideways on a narrow screen.
    expect(report).toContain('<div class="scroll">')
  })
})

describe('the remediation block', () => {
  it('says who a barrier stops and what to change', () => {
    const readable = text(report)

    expect(readable).toContain('screen reader')
    expect(readable).toContain('Fix.')
  })

  it('shows the corrected form of the markup that actually failed', () => {
    const withImage = [blank({ violations: [finding()] })]

    // The failing element is <img src="/logo.svg"> with no alt. Quotes are
    // left alone by escapeText, which only has to make the markup safe between
    // tags.
    expect(build(withImage)).toContain('class="suggested"')
    expect(build(withImage)).toContain('alt="What this image shows"')
  })

  it('gives the framework-specific fix when the project names one', () => {
    const withLang = [
      blank({
        violations: [
          finding({
            ruleId: 'html-has-lang',
            help: '<html> element must have a lang attribute',
            nodes: [{ html: '<html>', target: ['html'] }],
          }),
        ],
      }),
    ]

    expect(text(build(withLang, { framework: 'astro' }))).toContain('src/layouts')
    expect(text(build(withLang))).not.toContain('src/layouts')
  })
})

describe('the source location of a failing element', () => {
  it('names the line as well as the file, so an editor can open it', () => {
    const withImage = [blank({ violations: [finding()] })]

    const html = build(withImage, {
      componentFor: () => ({ file: 'src/components/Header.astro', line: 12, column: 5 }),
    })

    expect(text(html)).toContain('src/components/Header.astro:12')
  })
})
