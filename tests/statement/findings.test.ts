import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../../src/audit/report/json.ts'
import { StatementError } from '../../src/statement/error.ts'
import {
  readAuditReport,
  SUPPORTED_REPORT_SCHEMA,
  summariseAuditReport,
} from '../../src/statement/findings.ts'

const FIXTURE = path.join(import.meta.dirname, '../fixtures/statement/audit.json')

async function fixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(FIXTURE, 'utf8')) as Record<string, unknown>
}

/** The smallest document the reader accepts, to build invalid ones from. */
function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-21T09:30:00.000Z',
    summary: { pages: 1, needsReview: 0, notEvaluated: 0 },
    rules: {
      'image-alt': {
        help: 'Images must have alternative text',
        successCriteria: ['1.1.1'],
        en301549: ['9.1.1.1'],
      },
    },
    pages: [{ path: 'index.html', violations: [{ ruleId: 'image-alt', impact: 'critical' }] }],
    ...overrides,
  }
}

describe('summariseAuditReport', () => {
  it('reads the version the JSON report writes', () => {
    // The reader does not import the writer, so that the statement path stays
    // free of axe-core. This is what keeps the two constants honest.
    expect(SUPPORTED_REPORT_SCHEMA).toBe(SCHEMA_VERSION)
  })

  it('folds a rule that failed on several pages into one barrier', async () => {
    const summary = summariseAuditReport(await fixture())
    const contrast = summary.findings.find((finding) => finding.ruleId === 'color-contrast')

    expect(contrast?.pages).toEqual([
      'blog/2026-06-eaa.html',
      'blog/index.html',
      'impressum.html',
      'index.html',
      'kontakt.html',
      'leistungen.html',
      'team.html',
    ])
  })

  it('carries the standards references from the rule index', async () => {
    const summary = summariseAuditReport(await fixture())
    const imageAlt = summary.findings.find((finding) => finding.ruleId === 'image-alt')

    expect(imageAlt?.successCriteria).toEqual(['1.1.1'])
    expect(imageAlt?.en301549).toEqual(['9.1.1.1'])
    expect(imageAlt?.help).toBe('Images must have alternative text')
  })

  it('orders barriers by severity, then by rule id', async () => {
    const summary = summariseAuditReport(await fixture())

    // An unclassified impact leads, on the same reasoning as --fail-on: not
    // knowing how bad a barrier is is not evidence that it is mild.
    expect(summary.findings.map((finding) => finding.ruleId)).toEqual([
      'form-field-multiple-labels',
      'image-alt',
      'color-contrast',
      'landmark-one-main',
    ])
  })

  it('sorts equally severe barriers by rule id', () => {
    const summary = summariseAuditReport(
      report({
        rules: {
          zebra: { help: 'Z', successCriteria: [], en301549: [] },
          alpha: { help: 'A', successCriteria: [], en301549: [] },
        },
        pages: [
          {
            path: 'index.html',
            violations: [
              { ruleId: 'zebra', impact: 'serious' },
              { ruleId: 'alpha', impact: 'serious' },
            ],
          },
        ],
      }),
    )

    expect(summary.findings.map((finding) => finding.ruleId)).toEqual(['alpha', 'zebra'])
  })

  it('keeps the impact axe-core assigned, and null when it assigned none', async () => {
    const summary = summariseAuditReport(await fixture())
    const byRule = new Map(summary.findings.map((finding) => [finding.ruleId, finding.impact]))

    expect(byRule.get('image-alt')).toBe('critical')
    expect(byRule.get('landmark-one-main')).toBe('moderate')
    expect(byRule.get('form-field-multiple-labels')).toBeNull()
  })

  it('treats an impact it does not recognise as unclassified', () => {
    const summary = summariseAuditReport(
      report({
        pages: [{ path: 'index.html', violations: [{ ruleId: 'image-alt', impact: 'cosmetic' }] }],
      }),
    )

    expect(summary.findings[0]?.impact).toBeNull()
  })

  it('carries the counts the barrier list does not show', async () => {
    const summary = summariseAuditReport(await fixture())

    expect(summary.pages).toBe(8)
    expect(summary.needsReview).toBe(2)
    expect(summary.notEvaluated).toBe(12)
    expect(summary.generatedAt).toBe('2026-08-21T09:30:00.000Z')
  })

  it('leaves rules that need review or could not be evaluated out of the barriers', async () => {
    const summary = summariseAuditReport(await fixture())

    // 12 rules were never decided and 2 need a human. Listing either as a
    // barrier would claim a verdict the audit did not reach.
    expect(summary.findings).toHaveLength(4)
  })

  it('ignores rules the index knows about but no page failed', async () => {
    const summary = summariseAuditReport(await fixture())

    expect(summary.findings.map((finding) => finding.ruleId)).not.toContain('html-has-lang')
  })

  it('produces nothing from a clean run', () => {
    const summary = summariseAuditReport(
      report({ pages: [{ path: 'index.html', violations: [] }] }),
    )

    expect(summary.findings).toEqual([])
  })

  it('does not repeat a page that failed the same rule twice', () => {
    const summary = summariseAuditReport(
      report({
        pages: [
          {
            path: 'index.html',
            violations: [
              { ruleId: 'image-alt', impact: 'critical' },
              { ruleId: 'image-alt', impact: 'critical' },
            ],
          },
        ],
      }),
    )

    expect(summary.findings[0]?.pages).toEqual(['index.html'])
  })

  it('rejects a document that is not a report at all', () => {
    expect(() => summariseAuditReport({ hello: 'world' }, 'a11y.json')).toThrow(StatementError)
    expect(() => summariseAuditReport({ hello: 'world' }, 'a11y.json')).toThrow(
      /a11y\.json is not an eaa-kit JSON report/,
    )
  })

  it('rejects a schema version it does not know how to read', () => {
    expect(() => summariseAuditReport(report({ schemaVersion: 2 }))).toThrow(
      /schemaVersion 2; this version of eaa-kit reads 1/,
    )
  })

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'rejects a violation naming %s, which every object appears to have',
    (ruleId) => {
      // `rules['constructor']` reaches Object.prototype and comes back truthy,
      // which walked straight past the missing-rule check and put a barrier
      // with no description at all into the statement.
      expect(() =>
        summariseAuditReport(
          report({
            pages: [{ path: 'index.html', violations: [{ ruleId, impact: 'serious' }] }],
          }),
          'a11y.json',
        ),
      ).toThrow(new RegExp(`references rule ${ruleId.replace(/[$]/g, '\\$&')}`))
    },
  )

  it('names a rule the report references but does not describe', () => {
    // Silently dropping it would lose a barrier out of a legal document.
    expect(() =>
      summariseAuditReport(
        report({
          pages: [{ path: 'index.html', violations: [{ ruleId: 'ghost', impact: 'serious' }] }],
        }),
      ),
    ).toThrow(/references rule ghost, which is not in its rule index/)
  })
})

describe('readAuditReport', () => {
  it('reads a report from disk', async () => {
    const summary = await readAuditReport(FIXTURE)

    expect(summary.findings).toHaveLength(4)
  })

  it('resolves a relative path against the working directory it is given', async () => {
    const summary = await readAuditReport('audit.json', path.dirname(FIXTURE))

    expect(summary.pages).toBe(8)
  })

  it('reports a file that is not there', async () => {
    await expect(readAuditReport('nope.json', path.dirname(FIXTURE))).rejects.toThrow(
      /Could not read the audit report at nope\.json/,
    )
  })

  it('reports a file that is not JSON', async () => {
    await expect(readAuditReport('../site/index.html', path.dirname(FIXTURE))).rejects.toThrow(
      /index\.html is not valid JSON/,
    )
  })
})
