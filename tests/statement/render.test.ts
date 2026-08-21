import { describe, expect, it } from 'vitest'
import type { EaaConfigInput } from '../../src/config/define.ts'
import { parseConfig } from '../../src/config/define.ts'
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

  it('refuses a country whose template does not exist yet, naming what does', async () => {
    // Switzerland is planned. Rendering a placeholder as somebody's legal
    // document would be far worse than failing.
    await expect(render({ enforcement: { country: 'CH' } })).rejects.toThrow(StatementError)
    await expect(render({ enforcement: { country: 'CH' } })).rejects.toThrow(
      /Available: at\.de, at\.en, de\.de, de\.en/,
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
    { country: 'DE', locale: 'de' },
    { country: 'DE', locale: 'en' },
  ] as const

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
