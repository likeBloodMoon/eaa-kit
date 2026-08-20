import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AxeResults } from 'axe-core'
import axe from 'axe-core'
import { JSDOM, VirtualConsole } from 'jsdom'
import { beforeAll, describe, expect, it } from 'vitest'
import { type CollectedPage, collectPages } from '../../../src/audit/collect.ts'
import {
  auditPage,
  ENGINE_BLIND_RULES,
  type PageAudit,
  runJsdomAudit,
} from '../../../src/audit/runners/jsdom.ts'

const SITE = fileURLToPath(new URL('../../fixtures/site', import.meta.url))

function page(audits: PageAudit[], relativePath: string): PageAudit {
  const found = audits.find((audit) => audit.relativePath === relativePath)
  if (!found) throw new Error(`no audit for ${relativePath}`)
  return found
}

function inlinePage(html: string, relativePath = 'inline.html'): CollectedPage {
  return { html, relativePath, absolutePath: path.join(SITE, relativePath) }
}

function engineLimitations(audit: PageAudit): string[] {
  return audit.incomplete
    .filter((finding) => finding.reason === 'engine-limitation')
    .map((finding) => finding.ruleId)
}

/**
 * axe-core in jsdom with no post-processing, used to pin down what the engine
 * claims on its own. Kept deliberately separate from the runner so it cannot
 * inherit the runner's corrections.
 */
async function runAxeWithoutDowngrades(html: string, tags: string[]): Promise<AxeResults> {
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', () => {})
  const dom = new JSDOM(html, {
    url: 'https://example.test/',
    virtualConsole,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  try {
    dom.window.eval(axe.source)
    const { axe: pageAxe } = dom.window as unknown as { axe: typeof axe }
    return await pageAxe.run(dom.window.document, {
      runOnly: { type: 'tag', values: tags },
      // Mirrors the runner. Leaving preload on costs a 10s timeout per
      // preload-dependent rule, since jsdom never fetches what they wait for.
      preload: false,
    })
  } finally {
    dom.window.close()
  }
}

let pages: CollectedPage[]
let audits: PageAudit[]

beforeAll(async () => {
  pages = await collectPages(SITE)
  audits = await runJsdomAudit(pages)
}, 60_000)

describe('runJsdomAudit', () => {
  it('returns one audit per collected page, in order', () => {
    expect(audits.map((audit) => audit.relativePath)).toEqual(
      pages.map((collected) => collected.relativePath),
    )
  })

  it('reports the violations the fixture page actually has', () => {
    const index = page(audits, 'index.html')

    expect(index.violations.map((finding) => finding.ruleId).sort()).toEqual([
      'html-has-lang',
      'image-alt',
      'link-name',
    ])
    expect(index.error).toBeUndefined()
  })

  it('reports no violations for an accessible page', () => {
    expect(page(audits, 'about/index.html').violations).toEqual([])
  })

  it('carries WCAG success criteria and EN 301 549 clauses on each finding', () => {
    const imageAlt = page(audits, 'index.html').violations.find(
      (finding) => finding.ruleId === 'image-alt',
    )

    expect(imageAlt?.successCriteria).toContain('1.1.1')
    expect(imageAlt?.enClauses).toContain('9.1.1.1')
    expect(imageAlt?.impact).toBe('critical')
    expect(imageAlt?.helpUrl).toContain('dequeuniversity.com')
  })

  it('points at the offending element', () => {
    const imageAlt = page(audits, 'index.html').violations.find(
      (finding) => finding.ruleId === 'image-alt',
    )

    expect(imageAlt?.nodes).toHaveLength(1)
    expect(imageAlt?.nodes[0]?.target).toEqual(['img'])
    expect(imageAlt?.nodes[0]?.html).toContain('<img')
    expect(imageAlt?.nodes[0]?.failureSummary).toBeTruthy()
  })
})

describe('layout-dependent rules', () => {
  it('never reports a blind rule as a pass, on any page', () => {
    for (const audit of audits) {
      for (const ruleId of audit.passes) {
        expect(ENGINE_BLIND_RULES).not.toHaveProperty(ruleId)
      }
    }
  })

  it('downgrades target-size, which axe-core reports as a pass in jsdom', async () => {
    // The trap this whole mechanism exists for: every box is 0x0 without
    // layout, so axe-core reports WCAG 2.5.8 as passing on a page whose targets
    // were never measured. Assert the raw behaviour first, so that if axe-core
    // or jsdom ever fixes it, this fails loudly and tells us we can trust the
    // rule again instead of leaving a stale downgrade in place.
    const html = '<!doctype html><title>T</title><a href="/x">x</a>'
    const rawResults = await runAxeWithoutDowngrades(html, ['wcag22aa'])
    expect(rawResults.passes.map((result) => result.id)).toContain('target-size')

    const audit = await auditPage(inlinePage(html), { tags: ['wcag22aa'] })

    expect(audit.passes).not.toContain('target-size')
    const targetSize = audit.incomplete.find((finding) => finding.ruleId === 'target-size')
    expect(targetSize?.reason).toBe('engine-limitation')
    expect(targetSize?.reasonDetail).toContain('geometry')
    expect(targetSize?.successCriteria).toContain('2.5.8')
  })

  it('reports colour contrast as an engine limitation rather than a verdict', () => {
    const index = page(audits, 'index.html')
    const contrast = index.incomplete.find((finding) => finding.ruleId === 'color-contrast')

    expect(contrast?.reason).toBe('engine-limitation')
    expect(index.violations.map((finding) => finding.ruleId)).not.toContain('color-contrast')
    expect(index.passes).not.toContain('color-contrast')
  })

  it('declares blind rules axe-core called inapplicable, which it cannot judge either', () => {
    // Without computed overflow, axe-core finds no candidate elements and calls
    // the rule inapplicable. That is a silent false negative, not a clean bill.
    const about = page(audits, 'about/index.html')

    const scrollable = about.incomplete.find(
      (finding) => finding.ruleId === 'scrollable-region-focusable',
    )
    expect(scrollable?.reason).toBe('engine-limitation')
  })

  it('declares a blind rule on every page that has candidate elements', () => {
    for (const audit of audits) {
      expect(engineLimitations(audit)).toContain('color-contrast')
    }
  })

  it('stays quiet about a blind rule when nothing on the page could match it', () => {
    // blog/post-1.html has no interactive elements, so axe-core calling
    // target-size inapplicable is a plain DOM fact that needs no layout.
    // Declaring it unevaluated there would be noise, not honesty.
    expect(engineLimitations(page(audits, 'blog/post-1.html'))).not.toContain('target-size')
    expect(engineLimitations(page(audits, 'index.html'))).toContain('target-size')
  })

  it('does not tell the user to re-run experimental rules in a browser', () => {
    // axe-core leaves these off by default, so --browser would not run them
    // either. Listing them as "not evaluated by this engine" would mislead.
    for (const audit of audits) {
      expect(engineLimitations(audit)).not.toContain('css-orientation-lock')
      expect(engineLimitations(audit)).not.toContain('p-as-heading')
    }
  })

  it('declares autoplaying audio, which axe-core calls inapplicable here', async () => {
    // WCAG 1.4.2. axe-core matches on media duration, which never loads without
    // fetching, so it reports the rule inapplicable on a page that plainly does
    // have autoplaying audio. Reporting nothing would be a silent false clean.
    const html =
      '<!doctype html><html lang="de"><title>T</title><body><main>' +
      '<audio autoplay src="/a.mp3"></audio><h1>Hallo</h1></main></body></html>'
    const rawResults = await runAxeWithoutDowngrades(html, ['wcag2a'])
    expect(rawResults.inapplicable.map((result) => result.id)).toContain('no-autoplay-audio')

    const audit = await auditPage(inlinePage(html), { tags: ['wcag2a'] })

    expect(engineLimitations(audit)).toContain('no-autoplay-audio')
  })

  it('only declares blind rules the tag filter would have run', async () => {
    const audit = await auditPage(inlinePage('<!doctype html><title>T</title><p>hi</p>'), {
      tags: ['wcag2a'],
    })
    const declared = audit.incomplete.map((finding) => finding.ruleId)

    // target-size is wcag22aa, colour contrast is wcag2aa; neither is in scope.
    expect(declared).not.toContain('target-size')
    expect(declared).not.toContain('color-contrast')
    // link-in-text-block is wcag2a, so it is.
    expect(declared).toContain('link-in-text-block')
  })
})

describe('incomplete results', () => {
  it('separates rules needing human review from engine limitations', () => {
    const bypass = page(audits, 'index.html').incomplete.find(
      (finding) => finding.ruleId === 'bypass',
    )

    expect(bypass?.reason).toBe('needs-review')
    expect(bypass?.reasonDetail).toBeTruthy()
  })

  it('still reports rules the engine can evaluate as passes', () => {
    const about = page(audits, 'about/index.html')

    expect(about.passes).toContain('document-title')
    expect(about.passes).toContain('html-has-lang')
    expect(about.passes).toContain('image-alt')
  })
})

describe('auditPage', () => {
  it('audits under a file:// URL by default', () => {
    expect(page(audits, 'index.html').url.startsWith('file://')).toBe(true)
  })

  it('audits under the real site URL when a baseUrl is given', async () => {
    const [first] = await runJsdomAudit(pages.slice(0, 1), { baseUrl: 'https://example.com' })

    expect(first?.url).toBe('https://example.com/about/index.html')
  })

  it('records an error instead of throwing when a page times out', async () => {
    const audit = await auditPage(inlinePage('<!doctype html><title>T</title>'), { timeoutMs: 1 })

    expect(audit.error).toMatch(/timed out/)
    expect(audit.violations).toEqual([])
  })

  it('handles an empty document without throwing', async () => {
    const audit = await auditPage(inlinePage(''))

    expect(audit.error).toBeUndefined()
    expect(Array.isArray(audit.violations)).toBe(true)
  })

  it('does not execute scripts on the page', async () => {
    // The page has no <title> element and a script that would create one. The
    // audit must see the built markup, not what the site's JavaScript does to
    // it, so document-title has to fail here.
    const audit = await auditPage(
      inlinePage(
        '<!doctype html><html lang="de"><body>' +
          '<script>document.title = "executed"</script>' +
          '<main><h1>Hallo</h1></main></body></html>',
      ),
    )

    expect(audit.error).toBeUndefined()
    expect(audit.violations.map((finding) => finding.ruleId)).toContain('document-title')
  })
})
