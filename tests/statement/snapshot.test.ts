import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseConfig } from '../../src/config/define.ts'
import { summariseAuditReport } from '../../src/statement/findings.ts'
import { renderStatement } from '../../src/statement/render.ts'

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

const COMBINATIONS = [
  { country: 'AT', locale: 'de' },
  { country: 'AT', locale: 'en' },
  { country: 'DE', locale: 'de' },
  { country: 'DE', locale: 'en' },
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

    await expect(statement.html).toMatchFileSnapshot(
      `./__snapshots__/statement.${statement.template}.html`,
    )
  })

  it('renders a statement with no audit report behind it', async () => {
    const { config } = await fixtures()

    const statement = await renderStatement(config)

    await expect(statement.markdown).toMatchFileSnapshot(
      './__snapshots__/statement.at.de.no-audit.md',
    )
  })
})
