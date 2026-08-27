import { describe, expect, it } from 'vitest'
import { auditPage } from '../../src/audit/runners/jsdom.ts'
import { toHtmlBody, toHtmlDocument } from '../../src/statement/html.ts'

function body(markdown: string): string {
  return toHtmlBody(markdown)
}

describe('block elements', () => {
  it('renders headings at the level they were written', () => {
    expect(body('# Erklärung')).toBe('<h1>Erklärung</h1>')
    expect(body('## Beschwerdeverfahren')).toBe('<h2>Beschwerdeverfahren</h2>')
    expect(body('### Detail')).toBe('<h3>Detail</h3>')
  })

  it('does not treat a hash without a space as a heading', () => {
    expect(body('#nothashtag')).toBe('<p>#nothashtag</p>')
  })

  it('joins a soft-wrapped paragraph back into one', () => {
    expect(body('Diese Website ist mit\nEN 301 549 vereinbar.')).toBe(
      '<p>Diese Website ist mit EN 301 549 vereinbar.</p>',
    )
  })

  it('keeps blank-line-separated paragraphs apart', () => {
    expect(body('One.\n\nTwo.')).toBe('<p>One.</p>\n<p>Two.</p>')
  })

  it('renders a horizontal rule before the disclaimer', () => {
    expect(body('---')).toBe('<hr>')
    expect(body('-----')).toBe('<hr>')
  })

  it('ends a paragraph when a heading, list or rule starts', () => {
    expect(body('Text.\n## Next')).toBe('<p>Text.</p>\n<h2>Next</h2>')
    expect(body('Text.\n- Item')).toBe('<p>Text.</p>\n<ul>\n  <li>Item</li>\n</ul>')
    expect(body('Text.\n---')).toBe('<p>Text.</p>\n<hr>')
  })

  it('ignores leading and trailing blank lines', () => {
    expect(body('\n\n# Title\n\n')).toBe('<h1>Title</h1>')
  })
})

describe('lists', () => {
  it('renders one item per bullet', () => {
    expect(body('- One\n- Two')).toBe('<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>')
  })

  it('accepts an asterisk bullet as well as a dash', () => {
    expect(body('* One')).toBe('<ul>\n  <li>One</li>\n</ul>')
  })

  it('keeps an indented detail line inside the item it belongs to', () => {
    // The templates put an issue's standards reference and reason here, and
    // promoting them to items of their own would read as separate barriers.
    expect(body('- Barrier\n  Requirement affected: WCAG 1.1.1\n  Reason: fixing it.')).toBe(
      '<ul>\n  <li>Barrier<br>\n  Requirement affected: WCAG 1.1.1<br>\n  Reason: fixing it.</li>\n</ul>',
    )
  })

  it('closes the list when the indentation stops', () => {
    expect(body('- One\n\nAfter.')).toBe('<ul>\n  <li>One</li>\n</ul>\n<p>After.</p>')
  })

  it('starts a new list after a paragraph between two of them', () => {
    expect(body('- One\n\nText.\n\n- Two')).toBe(
      '<ul>\n  <li>One</li>\n</ul>\n<p>Text.</p>\n<ul>\n  <li>Two</li>\n</ul>',
    )
  })
})

describe('inline content', () => {
  it('links a bare URL', () => {
    expect(body('https://example.at')).toBe(
      '<p><a href="https://example.at">https://example.at</a></p>',
    )
  })

  it('links a bare email address as mailto', () => {
    expect(body('- E-Mail: office@example.at')).toContain(
      '<a href="mailto:office@example.at">office@example.at</a>',
    )
  })

  it('leaves a sentence-ending full stop outside the link', () => {
    expect(body('Gilt für https://example.at.')).toBe(
      '<p>Gilt für <a href="https://example.at">https://example.at</a>.</p>',
    )
  })

  it('keeps a bracket the URL itself opened', () => {
    expect(body('https://de.wikipedia.org/wiki/Barrierefreiheit_(Web)')).toContain(
      'href="https://de.wikipedia.org/wiki/Barrierefreiheit_(Web)"',
    )
  })

  it('drops a closing bracket the prose opened', () => {
    expect(body('(siehe https://example.at)')).toBe(
      '<p>(siehe <a href="https://example.at">https://example.at</a>)</p>',
    )
  })

  it('escapes markup in the text it was given', () => {
    // axe-core help text says <html> element, and a statement that swallowed it
    // would be missing the only word that identifies the barrier.
    expect(body('- <html> element must have a lang attribute')).toContain(
      '&lt;html&gt; element must have a lang attribute',
    )
  })

  it('escapes an ampersand rather than inventing an entity', () => {
    expect(body('Meier & Söhne')).toBe('<p>Meier &amp; Söhne</p>')
  })

  it('never lets a quote into the href attribute', () => {
    // A quote cannot appear in a linkable URL, so it ends the link and the rest
    // stays text. Nothing can close the attribute from inside it.
    expect(body('https://example.at/?q="onmouseover=alert(1)')).toBe(
      '<p><a href="https://example.at/?q=">https://example.at/?q=</a>"onmouseover=alert(1)</p>',
    )
  })

  it('leaves markdown emphasis alone', () => {
    // A `**` in an issue description is a typo far more often than a request
    // for bold, and dropping characters out of a legal document is worse.
    expect(body('Ein **wichtiger** Hinweis.')).toBe('<p>Ein **wichtiger** Hinweis.</p>')
  })
})

describe('toHtmlDocument', () => {
  const markdown = '# Erklärung zur Barrierefreiheit\n\nMusterbetrieb GmbH.\n'

  it('takes the title from the first level-1 heading', () => {
    const html = toHtmlDocument(markdown, { lang: 'de', fallbackTitle: 'Musterbetrieb' })

    expect(html).toContain('<title>Erklärung zur Barrierefreiheit</title>')
  })

  it('falls back to the title it was given when there is no heading', () => {
    const html = toHtmlDocument('Just prose.', { lang: 'de', fallbackTitle: 'Musterbetrieb' })

    expect(html).toContain('<title>Musterbetrieb</title>')
  })

  it('declares the language of the statement, not of the site', () => {
    const html = toHtmlDocument(markdown, { lang: 'en', fallbackTitle: 'Musterbetrieb' })

    expect(html).toContain('<html lang="en">')
  })

  it('is a complete, self-contained document', () => {
    const html = toHtmlDocument(markdown, { lang: 'de', fallbackTitle: 'Musterbetrieb' })

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<meta name="viewport"')
    expect(html).toContain('<main>')
    expect(html).not.toMatch(/<link|<script/)
  })

  it('escapes the attributes it puts in the document head', () => {
    const html = toHtmlDocument('# T', { lang: 'de"x', fallbackTitle: 'y' })

    expect(html).toContain('<html lang="de&quot;x">')
  })

  it('escapes the title it puts in the document head', () => {
    const html = toHtmlDocument('# A <b>bold</b> claim', { lang: 'de', fallbackTitle: 'x' })

    expect(html).toContain('<title>A &lt;b&gt;bold&lt;/b&gt; claim</title>')
  })

  it('has no accessibility violations of its own', async () => {
    // A statement generator that emits an inaccessible statement has failed at
    // the one job it has. Audited with the same engine the audit command uses.
    const html = toHtmlDocument(
      [
        '# Erklärung zur Barrierefreiheit',
        '',
        'Musterbetrieb GmbH ist bemüht, die Website barrierefrei zu machen.',
        '',
        '## Nicht barrierefreie Inhalte',
        '',
        '- Die eingebettete Karte hat keinen Titel.',
        '  Betroffene Anforderung: WCAG 4.1.2',
        '',
        '## Feedback',
        '',
        '- E-Mail: office@example.at',
        '',
        '---',
        '',
        'Keine Rechtsberatung.',
      ].join('\n'),
      { lang: 'de', fallbackTitle: 'Musterbetrieb' },
    )

    const audit = await auditPage({
      absolutePath: '/statement.html',
      relativePath: 'statement.html',
      html,
    })

    expect(audit.error).toBeUndefined()
    expect(audit.violations).toEqual([])
  })
})
