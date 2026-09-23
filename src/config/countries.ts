import type { Country, StatementLocale } from './define.ts'

/**
 * What this tool knows about each country, in one place.
 *
 * Before 0.8.0 a country was spread across the enum, `init`'s locale table, the
 * docs and the snapshot list, and adding one meant finding all of them. This is
 * the list everything else reads, and `Record<Country, …>` makes a country added
 * to the enum without an entry here a type error rather than a gap somebody
 * discovers from a user.
 *
 * `statute` and `authority` are summaries for `eaa-kit countries` and the docs.
 * The wording a published statement uses lives in that country's templates,
 * where it is written in the language of the document. A test asserts that
 * `languages` matches the template files, so this list cannot claim a document
 * nobody wrote.
 */
export interface CountryInfo {
  /** In English, for the one list every reader shares. */
  name: string
  /** Statement languages, in the order they are listed. The law's own language comes first. */
  languages: readonly StatementLocale[]
  /** What `init` offers as the site's language. */
  siteLocale: string
  statute: string
  /** Who the enforcement section tells a reader to go to. */
  authority: string
  /**
   * Set where the citations were established from secondary sources only.
   * `eaa-kit countries` shows it, so nobody takes these templates to have had the
   * same checking as the others. It is removed once somebody checks the
   * citations against the primary text.
   */
  unverified?: true
}

export const COUNTRY_INFO: Record<Country, CountryInfo> = {
  AT: {
    name: 'Austria',
    languages: ['de', 'en'],
    siteLocale: 'de-AT',
    statute: 'Barrierefreiheitsgesetz (BaFG)',
    authority: 'Sozialministeriumservice',
  },
  BE: {
    name: 'Belgium',
    languages: ['fr', 'nl', 'en'],
    siteLocale: 'fr-BE',
    statute: 'Loi du 5 novembre 2023 / wet van 5 november 2023 (Code de droit économique)',
    authority: 'SPF Économie / FOD Economie, Economic Inspection',
    unverified: true,
  },
  CH: {
    name: 'Switzerland',
    languages: ['de', 'en'],
    siteLocale: 'de-CH',
    statute: 'Behindertengleichstellungsgesetz (BehiG), not an EAA transposition',
    authority: 'the courts; there is no supervisory body',
  },
  DE: {
    name: 'Germany',
    languages: ['de', 'en'],
    siteLocale: 'de-DE',
    statute: 'Barrierefreiheitsstärkungsgesetz (BFSG)',
    authority: 'Marktüberwachungsstelle der Länder (MLBF)',
  },
  ES: {
    name: 'Spain',
    languages: ['es', 'en'],
    siteLocale: 'es-ES',
    statute: 'Ley 11/2023, de 8 de mayo',
    authority:
      "the competent market surveillance authority, usually the autonomous community's consumer body",
  },
  FR: {
    name: 'France',
    languages: ['fr', 'en'],
    siteLocale: 'fr-FR',
    statute: 'Ordonnance n° 2023-859, and art. 47 of loi n° 2005-102',
    authority: 'Défenseur des droits, and Arcom',
  },
  IE: {
    name: 'Ireland',
    languages: ['en'],
    siteLocale: 'en-IE',
    statute: 'S.I. No. 636 of 2023',
    authority: 'Competition and Consumer Protection Commission (CCPC)',
    unverified: true,
  },
  IT: {
    name: 'Italy',
    languages: ['it', 'en'],
    siteLocale: 'it-IT',
    statute: 'D.lgs. 27 maggio 2022, n. 82 (legge Stanca)',
    authority: 'AgID',
  },
  NL: {
    name: 'Netherlands',
    languages: ['nl', 'en'],
    siteLocale: 'nl-NL',
    statute: 'Implementatiewet toegankelijkheidsvoorschriften producten en diensten',
    authority: 'ACM for services, RDI for products',
  },
  PL: {
    name: 'Poland',
    languages: ['pl', 'en'],
    siteLocale: 'pl-PL',
    statute: 'Ustawa z dnia 26 kwietnia 2024 r. (Dz.U. 2024 poz. 731)',
    authority: 'Prezes Zarządu PFRON',
    unverified: true,
  },
  PT: {
    name: 'Portugal',
    languages: ['pt', 'en'],
    siteLocale: 'pt-PT',
    statute: 'Decreto-Lei n.º 82/2022, de 6 de dezembro',
    authority: 'ANACOM for e-commerce services',
    unverified: true,
  },
}

/**
 * A country from what somebody typed: the code in any case, or the English name.
 *
 * Undefined rather than a default. A statement is a legal document under one
 * country's law, and quietly substituting another country for a typo is how
 * somebody ends up publishing an Austrian statement for a Polish shop.
 */
export function findCountry(value: string): Country | undefined {
  const wanted = value.trim().toLowerCase()
  if (wanted === '') return undefined
  for (const [code, info] of Object.entries(COUNTRY_INFO) as Array<[Country, CountryInfo]>) {
    if (code.toLowerCase() === wanted || info.name.toLowerCase() === wanted) return code
  }
  return undefined
}

/**
 * The country a site's language tag points at, when it points at one.
 *
 * The region decides where there is one: `de-AT` is Austria, `fr-BE` is
 * Belgium, and a region with no country listed here gives nothing. A bare language counts only where that language's own country is
 * listed, so `pl` is Poland and `fr` is France. English has no such country, so
 * `en` gives nothing. This is a default for `init` to offer, not an answer.
 * Which country's law applies depends on where the business sells, and a site's
 * language only suggests that.
 */
export function countryForLocale(tag: string): Country | undefined {
  const [language, region] = tag.toLowerCase().split('-')
  if (language === undefined) return undefined
  const codes = Object.keys(COUNTRY_INFO) as Country[]

  // A region this tool has no country for is a site aimed somewhere else, and
  // `fr-CA` is not a reason to offer France.
  if (region !== undefined) return codes.find((code) => code.toLowerCase() === region)
  return codes.find(
    (code) => COUNTRY_INFO[code].siteLocale.toLowerCase() === `${language}-${language}`,
  )
}
