import { describe, expect, it } from 'vitest'
import type { Country, EaaConfigInput } from '../../src/config/define.ts'
import { parseConfig } from '../../src/config/define.ts'
import type { AuditFinding, AuditSummary } from '../../src/statement/findings.ts'
import { renderStatement, StatementError } from '../../src/statement/render.ts'

const BASE: EaaConfigInput = {
  site: { name: 'Musterbetrieb', url: 'https://example.at', locale: 'de-AT' },
  provider: { legalName: 'Musterbetrieb GmbH', email: 'office@example.at' },
  compliance: { status: 'partially-compliant', assessedOn: '2026-08-21' },
  enforcement: { country: 'AT' },
}

function config(overrides: Partial<EaaConfigInput> = {}) {
  return parseConfig({ ...BASE, ...overrides })
}

async function render(overrides: Partial<EaaConfigInput> = {}, options = {}) {
  return renderStatement(config(overrides), options)
}

/** The templates hard-wrap, so a sentence is matched on one line. */
function flat(markdown: string): string {
  return markdown.replace(/\n/g, ' ')
}

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    ruleId: 'image-alt',
    help: 'Images must have alternative text',
    impact: 'critical',
    successCriteria: ['1.1.1'],
    en301549: ['9.1.1.1'],
    pages: ['index.html'],
    ...overrides,
  }
}

function audit(overrides: Partial<AuditSummary> = {}): AuditSummary {
  return {
    findings: [finding()],
    pages: 5,
    needsReview: 0,
    notEvaluated: 0,
    generatedAt: '2026-08-25T09:30:00.000Z',
    ...overrides,
  }
}

describe('template selection', () => {
  it('uses the country from the config and the site language', async () => {
    const statement = await render()

    expect(statement.template).toBe('at.de')
    expect(statement.markdown).toContain('Barrierefreiheitsgesetz (BaFG)')
  })

  it('renders German law for a German provider', async () => {
    const statement = await render({ enforcement: { country: 'DE' } })

    expect(statement.template).toBe('de.de')
    expect(statement.markdown).toContain('Barrierefreiheitsstärkungsgesetz (BFSG)')
    expect(statement.markdown).not.toContain('BaFG')
  })

  it('defaults to English for a non-German site', async () => {
    const statement = await render({
      site: { ...BASE.site, locale: 'en-GB' },
    })

    expect(statement.template).toBe('at.en')
    expect(statement.markdown).toContain('# Accessibility Statement')
  })

  it('honours an explicit language', async () => {
    const statement = await render({}, { locale: 'en' })

    expect(statement.template).toBe('at.en')
  })

  it('honours an explicit country', async () => {
    const statement = await render({}, { country: 'DE' })

    expect(statement.template).toBe('de.de')
  })

  it('renders Swiss law for a Swiss provider', async () => {
    const statement = await render({ enforcement: { country: 'CH' } })

    expect(statement.template).toBe('ch.de')
    expect(statement.markdown).toContain('Behindertengleichstellungsgesetz, BehiG')
    expect(statement.markdown).not.toContain('BaFG')
  })

  it('refuses a country whose template does not exist yet, naming what does', async () => {
    // The cast stands in for a country added to COUNTRIES before its template is
    // written. Rendering a placeholder as somebody's legal document would be far
    // worse than failing.
    const missing = { country: 'FR' as Country }

    await expect(renderStatement(config(), missing)).rejects.toThrow(StatementError)
    await expect(renderStatement(config(), missing)).rejects.toThrow(
      /Available: at\.de, at\.en, ch\.de, ch\.en, de\.de, de\.en/,
    )
  })
})

describe('compliance status', () => {
  it.each([
    ['compliant', 'vollständig vereinbar'],
    ['partially-compliant', 'teilweise vereinbar'],
    ['non-compliant', 'nicht vereinbar'],
  ] as const)('states %s in German', async (status, phrase) => {
    const statement = await render({
      compliance: { ...BASE.compliance, status },
    } as Partial<EaaConfigInput>)

    expect(statement.markdown).toContain(phrase)
  })

  it.each([
    ['compliant', 'fully compliant'],
    ['partially-compliant', 'partially compliant'],
    ['non-compliant', 'not compliant'],
  ] as const)('states %s in English', async (status, phrase) => {
    const statement = await render(
      { compliance: { ...BASE.compliance, status } } as Partial<EaaConfigInput>,
      { locale: 'en' },
    )

    expect(statement.markdown).toContain(phrase)
  })

  it('names the standard that was assessed against', async () => {
    const statement = await render()

    expect(statement.markdown).toContain('EN 301 549 V3.2.1 (WCAG 2.2 AA)')
  })
})

describe('known issues', () => {
  const withIssues: Partial<EaaConfigInput> = {
    compliance: {
      ...BASE.compliance,
      knownIssues: [
        {
          description: 'Die eingebettete Karte hat keinen Titel.',
          successCriteria: ['4.1.2'],
          en301549: ['9.4.1.2'],
          reason: 'fix-planned',
          remedyBy: '2026-12-31',
        },
        'Ältere PDF-Dokumente sind nicht barrierefrei.',
      ],
    },
  }

  it('lists each issue with its standards reference', async () => {
    const statement = await render(withIssues)

    expect(statement.markdown).toContain('- Die eingebettete Karte hat keinen Titel.')
    expect(statement.markdown).toContain('WCAG 4.1.2, EN 301 549 9.4.1.2')
    expect(statement.markdown).toContain('- Ältere PDF-Dokumente sind nicht barrierefrei.')
  })

  it('keeps an issue and its details in one list item', async () => {
    const statement = await render(withIssues)
    const lines = statement.markdown.split('\n')
    const start = lines.findIndex((line) => line.startsWith('- Die eingebettete'))

    // No blank line between the item and its detail lines, or markdown renders
    // them as separate paragraphs.
    expect(lines[start + 1]).toMatch(/^ {2}Betroffene Anforderung:/)
    expect(lines[start + 2]).toMatch(/^ {2}Grund:/)
  })

  it.each([
    ['fix-planned', 'wird behoben'],
    ['disproportionate-burden', 'unverhältnismäßige Belastung'],
    ['out-of-scope', 'nicht in den Anwendungsbereich'],
  ] as const)('gives the reason for %s', async (reason, phrase) => {
    const statement = await render({
      compliance: {
        ...BASE.compliance,
        knownIssues: [{ description: 'Etwas fehlt.', reason }],
      },
    } as Partial<EaaConfigInput>)

    expect(statement.markdown).toContain(phrase)
  })

  it('omits the reason line when none was given', async () => {
    const statement = await render({
      compliance: { ...BASE.compliance, knownIssues: ['Etwas fehlt.'] },
    } as Partial<EaaConfigInput>)

    expect(statement.markdown).not.toContain('Grund:')
  })

  it('says so when nothing is known to be inaccessible', async () => {
    const statement = await render()

    expect(statement.markdown).toContain('keine nicht barrierefreien Inhalte bekannt')
  })
})

describe('contact details', () => {
  it('always gives the feedback address', async () => {
    expect((await render()).markdown).toContain('E-Mail: office@example.at')
  })

  it('omits phone and address when they are not configured', async () => {
    const statement = await render()

    expect(statement.markdown).not.toContain('Telefon:')
    expect(statement.markdown).not.toContain('Anschrift:')
  })

  it('includes them when they are', async () => {
    const statement = await render({
      provider: { ...BASE.provider, phone: '+43 1 2345678', address: 'Hauptstraße 1, Wien' },
    })

    expect(statement.markdown).toContain('Telefon: +43 1 2345678')
    expect(statement.markdown).toContain('Anschrift: Hauptstraße 1, Wien')
  })
})

describe('dates', () => {
  it('formats in German for a German statement', async () => {
    expect((await render()).markdown).toContain('21. August 2026')
  })

  it('formats in English for an English statement', async () => {
    expect((await render({}, { locale: 'en' })).markdown).toContain('21 August 2026')
  })

  it('does not throw on a date it cannot format', async () => {
    // Everything reaching the formatter has been through a schema, so this is
    // defence rather than a path anyone should hit. A statement with an
    // odd-looking date is recoverable; a stack trace out of a document
    // generator is not.
    const statement = await renderStatement(config(), {
      audit: {
        findings: [],
        pages: 1,
        needsReview: 0,
        notEvaluated: 0,
        generatedAt: 'not-a-date',
      },
    })

    expect(statement.markdown).toContain('not-a-date')
  })

  it('never leaks the ISO form into the prose', async () => {
    expect((await render()).markdown).not.toContain('2026-08-21')
  })
})

describe('enforcement body', () => {
  it('names the Austrian authority for AT', async () => {
    expect((await render()).markdown).toContain('Sozialministeriumservice')
  })

  it('names the German authority for DE', async () => {
    const statement = await render({ enforcement: { country: 'DE' } })

    expect(statement.markdown).toContain('Marktüberwachungsstelle der Länder')
    expect(statement.markdown).not.toContain('Sozialministeriumservice')
  })
})

describe('every template', () => {
  const combinations = [
    { country: 'AT', locale: 'de' },
    { country: 'AT', locale: 'en' },
    { country: 'CH', locale: 'de' },
    { country: 'CH', locale: 'en' },
    { country: 'DE', locale: 'de' },
    { country: 'DE', locale: 'en' },
  ] as const

  it.each(combinations)(
    'leaves no unrendered tags with an audit in $country/$locale',
    async (c) => {
      const statement = await renderStatement(config(), {
        ...c,
        audit: {
          findings: [finding(), finding({ ruleId: 'x', successCriteria: [], en301549: [] })],
          pages: 5,
          needsReview: 1,
          notEvaluated: 3,
          generatedAt: '2026-08-25T09:30:00.000Z',
        },
      })

      expect(statement.markdown).not.toContain('{{')
      expect(statement.html).not.toContain('{{')
    },
  )

  it.each(combinations)('leaves no unrendered tags in $country/$locale', async (combination) => {
    const statement = await renderStatement(
      config({
        provider: { ...BASE.provider, phone: '+43 1 2345678', address: 'Wien' },
        compliance: {
          ...BASE.compliance,
          knownIssues: [{ description: 'x', successCriteria: ['1.4.3'], reason: 'fix-planned' }],
        },
      } as Partial<EaaConfigInput>),
      combination,
    )

    expect(statement.markdown).not.toContain('{{')
    expect(statement.markdown).not.toContain('}}')
  })

  it.each(combinations)('carries a disclaimer in $country/$locale', async (combination) => {
    const statement = await renderStatement(config(), combination)
    const disclaimer = combination.locale === 'de' ? 'keine Rechtsberatung' : 'not legal advice'

    expect(statement.markdown).toContain(disclaimer)
  })

  it.each(combinations)('says automated testing is partial in $country/$locale', async (combo) => {
    const statement = await renderStatement(config(), combo)
    const phrase = combo.locale === 'de' ? 'nur einen Teil' : 'only a subset'

    expect(statement.markdown).toContain(phrase)
  })

  it.each(combinations)('ends with a single trailing newline in $country/$locale', async (c) => {
    const statement = await renderStatement(config(), c)

    expect(statement.markdown.endsWith('\n')).toBe(true)
    expect(statement.markdown.endsWith('\n\n')).toBe(false)
  })
})

describe('feedback mechanism', () => {
  it('offers the feedback form when one is configured', async () => {
    const statement = await render({
      provider: { ...BASE.provider, feedbackUrl: 'https://example.at/kontakt' },
    })

    expect(statement.markdown).toContain('Kontaktformular: https://example.at/kontakt')
  })

  it('names it in English too', async () => {
    const statement = await render(
      { provider: { ...BASE.provider, feedbackUrl: 'https://example.at/contact' } },
      { locale: 'en' },
    )

    expect(statement.markdown).toContain('Contact form: https://example.at/contact')
  })

  it('leaves the line out when there is no form', async () => {
    const statement = await render()

    expect(statement.markdown).not.toContain('Kontaktformular')
  })
})

describe('barriers taken from an audit', () => {
  it('lists them after the ones the config describes', async () => {
    const statement = await renderStatement(
      config({
        compliance: { ...BASE.compliance, knownIssues: ['Eine bekannte Barriere.'] },
      } as Partial<EaaConfigInput>),
      { audit: audit() },
    )
    const configured = statement.markdown.indexOf('Eine bekannte Barriere.')
    const derived = statement.markdown.indexOf('Images must have alternative text')

    // The configured ones are written by a human, in the statement's language.
    expect(configured).toBeGreaterThan(-1)
    expect(derived).toBeGreaterThan(configured)
  })

  it('quotes the standards the rule maps to', async () => {
    const statement = await renderStatement(config(), { audit: audit() })

    expect(statement.markdown).toContain('Betroffene Anforderung: WCAG 1.1.1, EN 301 549 9.1.1.1')
  })

  it('omits the standards line for a rule that maps to none', async () => {
    const statement = await renderStatement(config(), {
      audit: audit({ findings: [finding({ successCriteria: [], en301549: [] })] }),
    })

    expect(statement.markdown).not.toContain('Betroffene Anforderung:')
  })

  it('names the pages the rule failed on', async () => {
    const statement = await renderStatement(config(), {
      audit: audit({ findings: [finding({ pages: ['index.html', 'about/index.html'] })] }),
    })

    expect(statement.markdown).toContain('Betroffene Seiten: index.html, about/index.html')
    expect(statement.markdown).not.toContain('weitere')
  })

  it('counts the rest once the list would get long', async () => {
    const pages = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `${name}.html`)
    const statement = await renderStatement(config(), {
      audit: audit({ findings: [finding({ pages })] }),
    })

    expect(statement.markdown).toContain(
      'Betroffene Seiten: a.html, b.html, c.html, d.html, e.html und 2 weitere',
    )
  })

  it('counts the rest in English too', async () => {
    const pages = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => `${name}.html`)
    const statement = await renderStatement(config(), {
      locale: 'en',
      audit: audit({ findings: [finding({ pages })] }),
    })

    expect(statement.markdown).toContain(
      'Pages affected: a.html, b.html, c.html, d.html, e.html and 1 more',
    )
  })

  it('says the description came from a tool, and names the rule', async () => {
    const statement = await renderStatement(config(), { audit: audit() })

    // axe-core's help text is English whatever the statement is written in, so
    // the document has to admit whose words those are.
    expect(statement.markdown).toContain(
      'Automatisiert erkannt (axe-core, Regel image-alt); bitte in eigenen Worten beschreiben.',
    )
  })

  it('says so in English too', async () => {
    const statement = await renderStatement(config(), { locale: 'en', audit: audit() })

    expect(statement.markdown).toContain(
      'Detected by automated testing (axe-core, rule image-alt); describe it in your own words.',
    )
  })

  it('gives a barrier a reason, since an audit report carries none', async () => {
    const statement = await renderStatement(config(), { audit: audit() })

    expect(statement.markdown).toContain('Grund: die Barriere ist bekannt und wird behoben.')
  })

  it('uses the reason the config chose for them', async () => {
    const statement = await renderStatement(
      config({
        compliance: { ...BASE.compliance, auditReason: 'disproportionate-burden' },
      } as Partial<EaaConfigInput>),
      { audit: audit() },
    )

    expect(statement.markdown).toContain('Grund: unverhältnismäßige Belastung.')
  })

  it('never invents a remedy date for one', async () => {
    const statement = await renderStatement(config(), { audit: audit() })

    expect(statement.markdown).not.toContain('Geplante Behebung bis:')
  })

  it('says nothing is known when a clean run is the only source', async () => {
    const statement = await renderStatement(config(), { audit: audit({ findings: [] }) })

    expect(statement.markdown).toContain('keine nicht barrierefreien Inhalte bekannt')
  })
})

describe('what the audit run covered', () => {
  it('says when it ran and how much it covered', async () => {
    const statement = await renderStatement(config(), { audit: audit() })

    expect(flat(statement.markdown)).toContain(
      'Die automatisierte Prüfung vom 25. August 2026 umfasste 5 Seiten dieser Website.',
    )
  })

  it('says it in the singular for a one-page site', async () => {
    const statement = await renderStatement(config(), { audit: audit({ pages: 1 }) })

    expect(flat(statement.markdown)).toContain('umfasste eine Seite dieser Website.')
    expect(statement.markdown).not.toContain('1 Seiten')
  })

  it('says it in English', async () => {
    const statement = await renderStatement(config(), { locale: 'en', audit: audit() })

    expect(flat(statement.markdown)).toContain(
      'The automated test run of 25 August 2026 covered 5 pages of this website.',
    )
  })

  it('says it in the English singular', async () => {
    const statement = await renderStatement(config(), {
      locale: 'en',
      audit: audit({ pages: 1 }),
    })

    expect(flat(statement.markdown)).toContain('covered one page of this website.')
  })

  it.each([
    [1, 'Bei einer weiteren Regelprüfung ist eine manuelle Beurteilung erforderlich.'],
    [4, 'Bei 4 weiteren Regelprüfungen ist eine manuelle Beurteilung erforderlich.'],
  ])('reports %i rules needing a human decision', async (needsReview, phrase) => {
    const statement = await renderStatement(config(), { audit: audit({ needsReview }) })

    expect(flat(statement.markdown)).toContain(phrase)
  })

  it.each([
    [1, 'One further rule check requires a manual decision.'],
    [4, '4 further rule checks require a manual decision.'],
  ])('reports %i rules needing a human decision in English', async (needsReview, phrase) => {
    const statement = await renderStatement(config(), {
      locale: 'en',
      audit: audit({ needsReview }),
    })

    expect(statement.markdown).toContain(phrase)
  })

  it.each([
    [1, 'Bei einer Regelprüfung erreichte das verwendete Werkzeug kein Ergebnis'],
    [7, 'Bei 7 Regelprüfungen erreichte das verwendete Werkzeug kein Ergebnis'],
  ])('reports %i rules it could not evaluate', async (notEvaluated, phrase) => {
    const statement = await renderStatement(config(), { audit: audit({ notEvaluated }) })

    // Never reported as met, in the statement as much as in the audit report.
    expect(flat(statement.markdown)).toContain(phrase)
    expect(flat(statement.markdown)).toContain('nicht als erfüllt ausgewiesen')
  })

  it.each([
    [1, 'One rule check could not be decided by the tool that was used'],
    [7, '7 rule checks could not be decided by the tool that was used'],
  ])('reports %i rules it could not evaluate in English', async (notEvaluated, phrase) => {
    const statement = await renderStatement(config(), {
      locale: 'en',
      audit: audit({ notEvaluated }),
    })

    expect(flat(statement.markdown)).toContain(phrase)
  })

  it('stays silent about counts that are zero', async () => {
    const statement = await renderStatement(config(), { audit: audit() })

    expect(statement.markdown).not.toContain('manuelle Beurteilung')
    expect(statement.markdown).not.toContain('kein Ergebnis')
  })

  it('says nothing about an audit run when there was none', async () => {
    const statement = await render()

    expect(statement.markdown).not.toContain('Die automatisierte Prüfung vom')
    // The standing caveat about automated testing is not conditional on one.
    expect(statement.markdown).toContain('Automatisierte\nWerkzeuge erkennen nur einen Teil')
  })
})

describe('html output', () => {
  it('is produced alongside the markdown, from the same document', async () => {
    const statement = await render()

    expect(statement.html).toContain('<h1>Erklärung zur Barrierefreiheit</h1>')
    expect(statement.html).toContain('<h2>Beschwerdeverfahren</h2>')
  })

  it('declares the language the statement was rendered in', async () => {
    expect((await render()).html).toContain('<html lang="de">')
    expect((await render({}, { locale: 'en' })).html).toContain('<html lang="en">')
  })

  it('falls back to the site name for the title when there is no heading', async () => {
    // Every template starts with one, so this only guards the fallback wiring.
    const statement = await render()

    expect(statement.html).not.toContain('<title>Musterbetrieb</title>')
    expect(statement.html).toContain('<title>Erklärung zur Barrierefreiheit</title>')
  })

  it('links the feedback address', async () => {
    expect((await render()).html).toContain('<a href="mailto:office@example.at">')
  })
})

describe('Switzerland is not the EU', () => {
  const swiss: Partial<EaaConfigInput> = { enforcement: { country: 'CH' } }

  it('does not claim the BehiG transposes the EAA', async () => {
    // The AT and DE statutes do transpose Directive (EU) 2019/882. The BehiG
    // predates it and is not a transposition of anything, so a statement that
    // said so would be stating something false about the law.
    const statement = await render(swiss)

    expect(statement.markdown).not.toContain('setzt die Richtlinie')
    expect(statement.markdown).toContain('nicht Mitglied der EU')
  })

  it('says the EAA may still reach a provider selling into the EU', async () => {
    const statement = await render(swiss)

    expect(statement.markdown).toContain('kann ihr dennoch unterliegen')
  })

  it('says so in English too', async () => {
    const statement = await render(swiss, { locale: 'en' })

    expect(statement.markdown).toContain('Switzerland is not a member of the EU')
    expect(statement.markdown).not.toContain('transposes Directive')
  })

  it('names the Swiss technical standard alongside the statute', async () => {
    expect((await render(swiss)).markdown).toContain('eCH-0059')
    expect((await render(swiss, { locale: 'en' })).markdown).toContain('eCH-0059')
  })

  it('does not invent a supervisory body Switzerland does not have', async () => {
    // AT and DE each name a market surveillance authority. Switzerland has none
    // for private websites, and pointing a reader at one would send them
    // somewhere that cannot help.
    const statement = await render(swiss)

    expect(statement.markdown).toContain('keine Marktüberwachungsstelle')
    expect(statement.markdown).not.toContain('Sozialministeriumservice')
    expect(statement.markdown).not.toContain('Marktüberwachungsstelle der Länder')
  })

  it('points at the legal remedies that do exist', async () => {
    const statement = await render(swiss)

    expect(flat(statement.markdown)).toContain('Artikel 8 BehiG')
    expect(flat(statement.markdown)).toContain('Artikel 9 BehiG')
    expect(statement.markdown).toContain('https://www.ebgb.admin.ch')
  })

  it('gives the out-of-scope reason under the Swiss statute', async () => {
    const statement = await render({
      ...swiss,
      compliance: {
        ...BASE.compliance,
        knownIssues: [{ description: 'Ein Archiv.', reason: 'out-of-scope' }],
      },
    } as Partial<EaaConfigInput>)

    expect(statement.markdown).toContain('Anwendungsbereich des BehiG')
  })
})
