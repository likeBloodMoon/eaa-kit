import pc from 'picocolors'
import { COUNTRY_INFO } from '../config/countries.ts'
import { COUNTRIES } from '../config/define.ts'

/**
 * `eaa-kit countries`.
 *
 * What a statement can be written for, without opening the docs: each
 * country's code, the languages it has, the statute it is written under and the
 * body a reader is sent to. Before this, nobody found out that `--country PT`
 * existed until they had read a table on another page.
 */

export interface CountriesCommandOptions {
  /** Machine-readable, for anything that wants to build a picker from it. */
  json?: boolean
  /** Colour. Defaults to whatever picocolors detects for this terminal. */
  color?: boolean
}

export function formatCountries(options: CountriesCommandOptions = {}): string {
  if (options.json) {
    const entries = COUNTRIES.map((code) => ({ code, ...COUNTRY_INFO[code] }))
    return `${JSON.stringify(entries, null, 2)}\n`
  }

  const colors = pc.createColors(options.color ?? pc.isColorSupported)
  const lines: string[] = []
  for (const code of COUNTRIES) {
    const info = COUNTRY_INFO[code]
    lines.push(
      `${colors.bold(code)}  ${info.name}  ${colors.dim(`(${info.languages.join(', ')})`)}`,
      `    Statute:   ${info.statute}`,
      `    Authority: ${info.authority}`,
    )
    // Said on the list itself, and not only in the docs, because this list is
    // where somebody picks the country they will publish a document under.
    if (info.unverified) {
      lines.push(colors.yellow('    Citations not yet checked against the primary text'))
    }
    lines.push('')
  }
  lines.push('eaa-kit statement --country <code> --lang <language>')
  return `${lines.join('\n')}\n`
}
