import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Ajv } from 'ajv'
import addFormats from 'ajv-formats'
import { beforeAll, describe, expect, it } from 'vitest'
import { collectPages } from '../../../src/audit/collect.ts'
import {
  buildSarifReport,
  type SarifLog,
  serialiseSarifReport,
  toSarifLevel,
} from '../../../src/audit/report/sarif.ts'
import { type PageAudit, runJsdomAudit } from '../../../src/audit/runners/jsdom.ts'

const SITE = fileURLToPath(new URL('../../fixtures/site', import.meta.url))
const IMPACTS = fileURLToPath(new URL('../../fixtures/impacts', import.meta.url))
// Vendored from https://json.schemastore.org/sarif-2.1.0.json so validation
// needs no network. Refresh it if SARIF itself is revised.
const SCHEMA = fileURLToPath(new URL('../../fixtures/schema/sarif-2.1.0.json', import.meta.url))
const NOW = new Date('2026-08-20T18:00:00.000Z')
const CWD = fileURLToPath(new URL('../../..', import.meta.url))

let validate: (value: unknown) => boolean
let validationErrors: () => string
let siteAudits: PageAudit[]
let impactAudits: PageAudit[]
let log: SarifLog

function build(audits: readonly PageAudit[], directory: string): SarifLog {
  return buildSarifReport(audits, { directory, cwd: CWD, now: NOW })
}

beforeAll(async () => {
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true })
  addFormats(ajv)
  const schema = JSON.parse(await readFile(SCHEMA, 'utf8'))
  const compiled = ajv.compile(schema)
  validate = compiled as unknown as (value: unknown) => boolean
  validationErrors = () => JSON.stringify(compiled.errors, null, 2)

  siteAudits = await runJsdomAudit(await collectPages(SITE))
  impactAudits = await runJsdomAudit(await collectPages(IMPACTS))
  log = build(siteAudits, 'tests/fixtures/site')
}, 120_000)

describe('SARIF 2.1.0 schema', () => {
  it('validates a report with violations', () => {
    const valid = validate(log)

    expect(valid, validationErrors()).toBe(true)
  })

  it('validates a report with no violations at all', () => {
    const clean = siteAudits.filter((audit) => audit.relativePath === 'about/index.html')

    const valid = validate(build(clean, 'tests/fixtures/site'))

    expect(valid, validationErrors()).toBe(true)
  })

  it('validates a report for an empty run', () => {
    const valid = validate(build([], 'dist'))

    expect(valid, validationErrors()).toBe(true)
  })

  it('validates a report containing a page that could not be audited', () => {
    const failed: PageAudit = {
      relativePath: 'broken.html',
      absolutePath: '/tmp/broken.html',
      url: 'file:///tmp/broken.html',
      engine: 'jsdom',
      violations: [],
      incomplete: [],
      passes: [],
      inapplicable: [],
      durationMs: 2,
      error: 'axe-core timed out after 30000ms',
    }

    const valid = validate(build([failed], 'dist'))

    expect(valid, validationErrors()).toBe(true)
  })

  it('declares the version and schema GitHub expects', () => {
    expect(log.version).toBe('2.1.0')
    expect(log.$schema).toContain('sarif-schema-2.1.0.json')
  })

  it.each([
    ['a level outside the SARIF enum', { level: 'blocker' }],
    ['a result with no message', { message: undefined }],
    ['a rule descriptor with no id', { ruleless: true }],
  ])('rejects %s, so the check above is not vacuous', (_label, mutation) => {
    // A validator that accepts anything would make every test in this block
    // pass. Prove it refuses documents SARIF does not allow.
    const broken = structuredClone(log) as unknown as {
      runs: Array<{ results: unknown[]; tool: { driver: { rules: unknown[] } } }>
    }
    const run = broken.runs[0]
    if (!run) throw new Error('no run')

    if ('level' in mutation) {
      run.results = [{ message: { text: 'x' }, level: mutation.level }]
    } else if ('message' in mutation) {
      run.results = [{ level: 'error' }]
    } else {
      run.tool.driver.rules = [{ shortDescription: { text: 'no id here' } }]
    }

    expect(validate(broken)).toBe(false)
  })
})

describe('tool.driver.rules', () => {
  it('describes every rule the run knows about', () => {
    const ruleIds = log.runs[0]?.tool.driver.rules.map((rule) => rule.id) ?? []
    const seen = new Set<string>()
    for (const audit of siteAudits) {
      for (const outcome of [
        ...audit.violations,
        ...audit.incomplete,
        ...audit.passes,
        ...audit.inapplicable,
      ]) {
        seen.add(outcome.ruleId)
      }
    }

    expect(ruleIds.sort()).toEqual([...seen].sort())
  })

  it('carries help text and a help URL for each rule', () => {
    for (const rule of log.runs[0]?.tool.driver.rules ?? []) {
      expect(rule.shortDescription.text.length).toBeGreaterThan(0)
      expect(rule.help.text.length).toBeGreaterThan(0)
      expect(rule.helpUri).toMatch(/^https:\/\//)
    }
  })

  it('puts the standards references in the help text and tags', () => {
    const imageAlt = log.runs[0]?.tool.driver.rules.find((rule) => rule.id === 'image-alt')

    expect(imageAlt?.help.text).toContain('WCAG 1.1.1')
    expect(imageAlt?.help.text).toContain('EN 301 549 9.1.1.1')
    expect(imageAlt?.properties.tags).toContain('accessibility')
    expect(imageAlt?.properties.tags).toContain('wcag-1.1.1')
  })

  it('names the tool and its version', () => {
    expect(log.runs[0]?.tool.driver.name).toBe('eaa-kit')
    expect(log.runs[0]?.tool.driver.version).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('results', () => {
  it('points ruleIndex at the matching rule descriptor', () => {
    const rules = log.runs[0]?.tool.driver.rules ?? []

    for (const result of log.runs[0]?.results ?? []) {
      expect(rules[result.ruleIndex]?.id).toBe(result.ruleId)
    }
  })

  it('uses the page file as the artifact location, relative and POSIX', () => {
    const uris = log.runs[0]?.results.map(
      (result) => result.locations[0]?.physicalLocation.artifactLocation.uri,
    )

    expect(uris).toContain('tests/fixtures/site/index.html')
    for (const uri of uris ?? []) {
      expect(uri).not.toContain('\\')
      expect(uri?.startsWith('/')).toBe(false)
    }
  })

  it('puts the CSS selector in the message', () => {
    const imageAlt = log.runs[0]?.results.find((result) => result.ruleId === 'image-alt')

    expect(imageAlt?.message.text).toBe('Images must have alternative text. Element: img')
  })

  it('emits one result per offending element', () => {
    const violations = siteAudits.flatMap((audit) => audit.violations)
    const elements = violations.reduce(
      (total, finding) => total + Math.max(finding.nodes.length, 1),
      0,
    )

    expect(log.runs[0]?.results.length).toBe(elements)
  })

  it('marks results as failures', () => {
    for (const result of log.runs[0]?.results ?? []) {
      expect(result.kind).toBe('fail')
    }
  })

  it('fingerprints results so alerts survive a file move', () => {
    for (const result of log.runs[0]?.results ?? []) {
      expect(result.partialFingerprints['eaaKit/v2']).toMatch(/^[0-9a-f]{16}$/)
    }
  })

  it('reports only violations, not incomplete or inapplicable rules', () => {
    // A page whose only findings are unevaluated rules produces no results.
    const reviewed = log.runs[0]?.results.map((result) => result.ruleId) ?? []

    expect(reviewed).not.toContain('color-contrast')
    expect(reviewed).not.toContain('target-size')
  })
})

describe('impact to level mapping', () => {
  it.each([
    ['critical', 'error'],
    ['serious', 'error'],
    ['moderate', 'warning'],
    ['minor', 'note'],
  ] as const)('maps %s to %s', (impact, level) => {
    expect(toSarifLevel(impact)).toBe(level)
  })

  it('treats an unclassified impact as an error rather than waving it through', () => {
    expect(toSarifLevel(null)).toBe('error')
  })

  it('applies the mapping end to end, one fixture page per level', () => {
    const sarif = build(impactAudits, 'tests/fixtures/impacts')
    const levels = Object.fromEntries(
      sarif.runs[0]?.results.map((result) => [result.ruleId, result.level]) ?? [],
    )

    expect(levels['image-alt']).toBe('error')
    expect(levels['blink']).toBe('error')
    expect(levels['html-xml-lang-mismatch']).toBe('warning')
    expect(levels['aria-deprecated-role']).toBe('note')
  })
})

describe('run metadata', () => {
  it('marks the invocation successful when every page was audited', () => {
    expect(log.runs[0]?.invocations[0]?.executionSuccessful).toBe(true)
    expect(log.runs[0]?.invocations[0]?.toolExecutionNotifications).toEqual([])
  })

  it('reports an unauditable page as a failed invocation', () => {
    const failed: PageAudit = {
      relativePath: 'broken.html',
      absolutePath: '/tmp/broken.html',
      url: 'file:///tmp/broken.html',
      engine: 'jsdom',
      violations: [],
      incomplete: [],
      passes: [],
      inapplicable: [],
      durationMs: 2,
      error: 'axe-core timed out after 30000ms',
    }

    const invocation = build([failed], 'dist').runs[0]?.invocations[0]

    expect(invocation?.executionSuccessful).toBe(false)
    expect(invocation?.toolExecutionNotifications[0]?.message.text).toContain('timed out')
  })

  it('keeps the unevaluated coverage in run properties, so no results is not read as clean', () => {
    const properties = log.runs[0]?.properties as {
      notEvaluated: number
      notEvaluatedRules: string[]
      engine: string
    }

    expect(properties.engine).toBe('jsdom')
    expect(properties.notEvaluated).toBeGreaterThan(0)
    expect(properties.notEvaluatedRules).toContain('color-contrast')
  })

  it('produces byte-identical output for the same run', () => {
    expect(serialiseSarifReport(build(siteAudits, 'tests/fixtures/site'))).toBe(
      serialiseSarifReport(build(siteAudits, 'tests/fixtures/site')),
    )
  })
})
