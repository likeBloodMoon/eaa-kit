import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseConfig } from '../../src/config/define.ts'
import { summariseAuditReport } from '../../src/statement/findings.ts'
import { renderStatement } from '../../src/statement/render.ts'
import { TOOL_VERSION } from '../../src/version.ts'

/**
 * Whole-document snapshots of every template, from a config and an audit report
 * checked in as fixtures.
 *
 * The unit tests assert one branch each and would not notice a heading that
 * moved, a paragraph that collapsed into the one above it, or a barrier that
 * quietly stopped being listed. These files are the reviewable form: a change
 * to any template shows up here as the diff a reader would see.
 */

const FIXTURES = path.join(import.meta.dirname, '../fixtures/statement')
const TEMPLATES = path.join(import.meta.dirname, '../../src/statement/templates')

/**
 * The generator meta tag carries the package version, which changes on every
 * release and would otherwise rewrite every HTML snapshot for a reason that
 * has nothing to do with what these files are for. The version is asserted on
 * its own below; here it is held still so the diff is the prose.
 */
function stable(html: string): string {
  return html.replaceAll(TOOL_VERSION, '0.0.0-test')
}

/**
 * Every template there is, which is a sparse matrix: each country has the
 * language its law is administered in, and English. A country added without a
 * line here would have no snapshot and no reviewable form, so the count is
 * asserted against the template directory below.
 */
const COMBINATIONS = [
  { country: 'AT', locale: 'de' },
  { country: 'AT', locale: 'en' },
  { country: 'CH', locale: 'de' },
  { country: 'CH', locale: 'en' },
  { country: 'DE', locale: 'de' },
  { country: 'DE', locale: 'en' },
  { country: 'ES', locale: 'en' },
  { country: 'ES', locale: 'es' },
  { country: 'FR', locale: 'en' },
  { country: 'FR', locale: 'fr' },
  { country: 'IT', locale: 'en' },
  { country: 'IT', locale: 'it' },
  { country: 'NL', locale: 'en' },
  { country: 'NL', locale: 'nl' },
] as const

async function fixtures() {
  const [config, report] = await Promise.all([
    readFile(path.join(FIXTURES, 'eaa.config.json'), 'utf8'),
    readFile(path.join(FIXTURES, 'audit.json'), 'utf8'),
  ])

  return {
    config: parseConfig(JSON.parse(config), 'eaa.config.json'),
    audit: summariseAuditReport(JSON.parse(report), 'audit.json'),
  }
}

describe('statement snapshots', () => {
  it.each(COMBINATIONS)('renders $country/$locale as markdown', async (combination) => {
    const { config, audit } = await fixtures()

    const statement = await renderStatement(config, { ...combination, audit })

    await expect(statement.markdown).toMatchFileSnapshot(
      `./__snapshots__/statement.${statement.template}.md`,
    )
  })

  it.each(COMBINATIONS)('renders $country/$locale as HTML', async (combination) => {
    const { config, audit } = await fixtures()

    const statement = await renderStatement(config, { ...combination, audit })

    await expect(stable(statement.html)).toMatchFileSnapshot(
      `./__snapshots__/statement.${statement.template}.html`,
    )
  })

  it('covers every template that ships', async () => {
    // A country added without a line in COMBINATIONS would ship prose no
    // snapshot has ever shown a reader, which is the one thing these files
    // exist to prevent.
    const shipped = (await readdir(TEMPLATES))
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => entry.replace(/\.md$/, ''))
      .sort()

    expect(shipped).toEqual(
      COMBINATIONS.map(({ country, locale }) => `${country.toLowerCase()}.${locale}`).sort(),
    )
  })

  it('stamps the real package version into the generator meta tag', async () => {
    // What the snapshots above deliberately hold still, asserted once here so
    // normalising it cannot hide a version that stopped being written at all.
    const { config, audit } = await fixtures()

    const statement = await renderStatement(config, { country: 'AT', locale: 'de', audit })

    expect(statement.html).toContain(`<meta name="generator" content="eaa-kit ${TOOL_VERSION}">`)
  })

  it('renders a statement with no audit report behind it', async () => {
    const { config } = await fixtures()

    const statement = await renderStatement(config)

    await expect(statement.markdown).toMatchFileSnapshot(
      './__snapshots__/statement.at.de.no-audit.md',
    )
  })
})
