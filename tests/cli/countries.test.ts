import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatCountries } from '../../src/cli/countries.ts'
import {
  authorityChanged,
  authorityOn,
  COUNTRY_INFO,
  findCountry,
  localToday,
} from '../../src/config/countries.ts'
import { COUNTRIES, STATEMENT_LOCALES } from '../../src/config/define.ts'
import { isCalendarDate } from '../../src/text.ts'

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
    const text = formatCountries({ color: false, today: '2026-11-22' })

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

  it('names the new Swedish body from the day it takes over, and announces it before', () => {
    const before = formatCountries({ color: false, today: '2026-12-31' })
    const after = formatCountries({ color: false, today: '2027-01-01' })
    const sweden = (text: string) => text.split('\n\n').find((block) => block.startsWith('SE'))

    expect(sweden(before)).toContain('Authority: Post- och telestyrelsen (PTS)')
    expect(sweden(before)).toContain('From 2027-01-01: Digitaliseringsmyndigheten')
    expect(sweden(after)).toContain('Authority: Digitaliseringsmyndigheten')
    expect(sweden(after)).not.toContain('From 2027-01-01')
    expect(sweden(after)).not.toContain('PTS)\n')
  })

  it('switches on the local calendar day, not on UTC', () => {
    // 00:30 on New Year's Day in a UTC+1 zone is still 31 December in UTC.
    expect(localToday(new Date(2027, 0, 1, 0, 30))).toBe('2027-01-01')
    expect(localToday(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })

  it.each([
    ['2027-01-01', true],
    ['2028-02-29', true],
    ['2027-02-29', false],
    ['2027-02-30', false],
    ['2027-13-01', false],
    ['01.01.2027', false],
    ['2027-1-1', false],
  ])('takes %s as a calendar date: %s', (value, expected) => {
    expect(isCalendarDate(value)).toBe(expected)
  })

  it('knows which countries have a change scheduled', () => {
    expect(authorityChanged('SE', '2026-12-31')).toBe(false)
    expect(authorityChanged('SE', '2027-01-01')).toBe(true)
    expect(authorityOn('SE', '2027-01-01')).toMatch(/^Digitaliseringsmyndigheten/)
    for (const code of COUNTRIES.filter((c) => c !== 'SE')) {
      expect(authorityChanged(code, '2099-01-01')).toBe(false)
    }
  })

  it('resolves the authority by date in JSON too, and keeps the schedule', () => {
    const sweden = (today: string) =>
      (
        JSON.parse(formatCountries({ json: true, today })) as Array<{
          code: string
          authority: string
          authorityChange?: { on: string }
        }>
      ).find((entry) => entry.code === 'SE')

    expect(sweden('2026-12-31')?.authority).toBe('Post- och telestyrelsen (PTS)')
    expect(sweden('2027-01-01')?.authority).toMatch(/^Digitaliseringsmyndigheten/)
    expect(sweden('2027-01-01')?.authorityChange?.on).toBe('2027-01-01')
  })

  it('prints JSON with the code on every entry', () => {
    const parsed = JSON.parse(formatCountries({ json: true })) as Array<{ code: string }>

    expect(parsed.map((entry) => entry.code)).toEqual([...COUNTRIES])
  })
})
