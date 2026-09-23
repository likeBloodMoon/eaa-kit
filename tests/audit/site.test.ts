import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSiteFacts, siteFactsFrom } from '../../src/audit/site.ts'
import { countryForLocale } from '../../src/config/countries.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('siteFactsFrom', () => {
  it('reads the language, the canonical address and the title', () => {
    const facts = siteFactsFrom(
      '<!doctype html><html class="x" lang="pl-PL"><head><title> Sklep &amp; Kawiarnia </title>' +
        '<link href="https://sklep.pl/o-nas/" rel="canonical"></head></html>',
    )

    expect(facts).toEqual({ lang: 'pl-PL', url: 'https://sklep.pl', title: 'Sklep & Kawiarnia' })
  })

  it('falls back to og:url for the address', () => {
    const facts = siteFactsFrom(
      '<html><head><meta property="og:url" content="https://example.pt/"></head></html>',
    )

    expect(facts.url).toBe('https://example.pt')
  })

  it('states nothing a page does not state', () => {
    // A relative canonical says nothing about where the site lives, and a lang
    // that is not a language tag is not a language.
    expect(
      siteFactsFrom('<html lang="{{ lang }}"><link rel="canonical" href="/about"></html>'),
    ).toEqual({})
  })
})

describe('readSiteFacts', () => {
  it('reads the home page, or the first page when there is none', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-site-'))
    dirs.push(dir)
    await mkdir(path.join(dir, 'b'))
    await writeFile(path.join(dir, 'b', 'page.html'), '<html lang="nl-BE"></html>')
    await writeFile(path.join(dir, 'a.html'), '<html lang="fr-BE"></html>')

    expect((await readSiteFacts(dir)).lang).toBe('fr-BE')

    await writeFile(path.join(dir, 'index.html'), '<html lang="de-AT"></html>')
    expect((await readSiteFacts(dir)).lang).toBe('de-AT')
  })
})

describe('countryForLocale', () => {
  it.each([
    ['de-AT', 'AT'],
    ['fr-BE', 'BE'],
    ['nl-be', 'BE'],
    ['de', 'DE'],
    ['fr', 'FR'],
    ['pl', 'PL'],
    ['pt-PT', 'PT'],
    ['en-IE', 'IE'],
  ])('reads %s as %s', (tag, country) => {
    expect(countryForLocale(tag)).toBe(country)
  })

  it.each(['en', 'en-GB', 'fr-CA', 'pt-BR', 'sv-SE'])('offers nothing for %s', (tag) => {
    // English has no country of its own here, and a region this tool has no
    // country for is a site aimed somewhere else.
    expect(countryForLocale(tag)).toBeUndefined()
  })
})
