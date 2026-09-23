import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatCountries } from '../../src/cli/countries.ts'
import { COUNTRY_INFO, findCountry } from '../../src/config/countries.ts'
import { COUNTRIES, STATEMENT_LOCALES } from '../../src/config/define.ts'

const TEMPLATES = path.join(import.meta.dirname, '../../src/statement/templates')

describe('the country registry', () => {
  it('lists exactly the templates that exist', async () => {
    // Both directions: a template nobody registered is a document the CLI will
    // not offer, and a registered language with no template is a promise the
    // statement command breaks with an error.
    const onDisk = (await readdir(TEMPLATES))
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.replace(/\.md$/, ''))
      .sort()
    const registered = COUNTRIES.flatMap((code) =>
      COUNTRY_INFO[code].languages.map((locale) => `${code.toLowerCase()}.${locale}`),
    ).sort()

    expect(registered).toEqual(onDisk)
  })

  it('gives every country English, and its own language first', () => {
    for (const code of COUNTRIES) {
      const { languages } = COUNTRY_INFO[code]
      expect(languages).toContain('en')
      expect(STATEMENT_LOCALES).toEqual(expect.arrayContaining([...languages]))
    }
  })

  it('offers a site locale in a language the country has a statement in', () => {
    for (const code of COUNTRIES) {
      const { languages, siteLocale } = COUNTRY_INFO[code]
      expect(languages).toContain(siteLocale.split('-')[0])
    }
  })
})

describe('findCountry', () => {
  it.each([
    ['pl', 'PL'],
    ['PT', 'PT'],
    [' Belgium ', 'BE'],
    ['ireland', 'IE'],
  ])('reads %j as %s', (typed, expected) => {
    expect(findCountry(typed)).toBe(expected)
  })

  it.each(['', 'Narnia', 'EU', 'GB'])('does not guess at %j', (typed) => {
    expect(findCountry(typed)).toBeUndefined()
  })
})

describe('eaa-kit countries', () => {
  it('names every country, its languages, statute and authority', () => {
    const text = formatCountries({ color: false })

    for (const code of COUNTRIES) {
      const info = COUNTRY_INFO[code]
      expect(text).toContain(`${code}  ${info.name}  (${info.languages.join(', ')})`)
      expect(text).toContain(info.statute)
      expect(text).toContain(info.authority)
    }
  })

  it('says which countries have not had their citations checked', () => {
    const text = formatCountries({ color: false })
    const flagged = text.split('\n\n').filter((block) => block.includes('not yet checked'))

    expect(flagged.map((block) => block.slice(0, 2)).sort()).toEqual(
      COUNTRIES.filter((code) => COUNTRY_INFO[code].unverified).sort(),
    )
  })

  it('prints JSON with the code on every entry', () => {
    const parsed = JSON.parse(formatCountries({ json: true })) as Array<{ code: string }>

    expect(parsed.map((entry) => entry.code)).toEqual([...COUNTRIES])
  })
})
