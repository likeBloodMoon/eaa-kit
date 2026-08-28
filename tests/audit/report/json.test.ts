import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { collectPages } from '../../../src/audit/collect.ts'
import {
  buildJsonReport,
  type JsonReport,
  SCHEMA_VERSION,
  serialiseJsonReport,
} from '../../../src/audit/report/json.ts'
import { type PageAudit, runJsdomAudit } from '../../../src/audit/runners/jsdom.ts'

const SITE = fileURLToPath(new URL('../../fixtures/site', import.meta.url))
const NOW = new Date('2026-08-20T18:00:00.000Z')

let audits: PageAudit[]
let report: JsonReport

function build(pages: readonly PageAudit[] = audits): JsonReport {
  return buildJsonReport(pages, { directory: './dist', failOn: 'serious', now: NOW })
}

function page(doc: JsonReport, path: string) {
  const found = doc.pages.find((candidate) => candidate.path === path)
  if (!found) throw new Error(`no page ${path}`)
  return found
}

beforeAll(async () => {
  audits = await runJsdomAudit(await collectPages(SITE))
  report = build()
}, 60_000)

describe('document envelope', () => {
  it('declares a schema version', () => {
    expect(report.schemaVersion).toBe(SCHEMA_VERSION)
    expect(report.schemaVersion).toBe(1)
  })

  it('names the tool, its version and the axe-core it wrapped', () => {
    expect(report.tool.name).toBe('eaa-kit')
    expect(report.tool.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(report.tool.axeCore).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('timestamps the run in ISO 8601 UTC', () => {
    expect(report.generatedAt).toBe('2026-08-20T18:00:00.000Z')
  })

  it('records the engine', () => {
    expect(report.engine).toBe('jsdom')
  })

  it('records what was audited', () => {
    expect(report.target.directory).toBe('./dist')
    expect(report.target.baseUrl).toBeNull()
  })

  it('carries the base URL when the run used one', () => {
    const doc = buildJsonReport(audits, {
      directory: './dist',
      failOn: 'serious',
      baseUrl: 'https://example.com',
      now: NOW,
    })

    expect(doc.target.baseUrl).toBe('https://example.com')
  })
})

describe('per-page results', () => {
  it('keeps the four axe-core categories separate', () => {
    const index = page(report, 'index.html')

    expect(index.violations.map((finding) => finding.ruleId)).toContain('image-alt')
    expect(index.incomplete.map((finding) => finding.ruleId)).toContain('color-contrast')
    expect(index.passes.length).toBeGreaterThan(0)
    expect(index.inapplicable.length).toBeGreaterThan(0)
  })

  it('never lists an inapplicable rule as a pass', () => {
    for (const doc of report.pages) {
      for (const ruleId of doc.inapplicable) {
        expect(doc.passes).not.toContain(ruleId)
      }
    }
  })

  it('distinguishes needs-review from engine-limitation', () => {
    const index = page(report, 'index.html')
    const reasons = new Set(index.incomplete.map((finding) => finding.reason))

    expect(reasons).toContain('needs-review')
    expect(reasons).toContain('engine-limitation')
    for (const finding of index.incomplete) {
      expect(finding.reasonDetail).toBeTruthy()
    }
  })

  it('gives violations their impact and offending elements', () => {
    const imageAlt = page(report, 'index.html').violations.find(
      (finding) => finding.ruleId === 'image-alt',
    )

    expect(imageAlt?.impact).toBe('critical')
    expect(imageAlt?.nodes[0]?.target).toEqual(['img'])
    expect(imageAlt?.nodes[0]?.html).toContain('<img')
    expect(imageAlt?.nodes[0]?.failureSummary).toBeTruthy()
  })

  it('uses null, not absence, for a missing failure summary', () => {
    const nodes = report.pages.flatMap((doc) => doc.incomplete.flatMap((finding) => finding.nodes))

    for (const node of nodes) {
      expect(node).toHaveProperty('failureSummary')
    }
  })

  it('reports a page that could not be audited', () => {
    const failed: PageAudit = {
      relativePath: 'broken.html',
      absolutePath: '/tmp/broken.html',
      url: 'file:///tmp/broken.html',
      engine: 'jsdom',
      violations: [],
      incomplete: [],
      passes: [],
      inapplicable: [],
      durationMs: 3,
      error: 'axe-core timed out after 30000ms',
    }

    const doc = build([failed])

    expect(doc.pages[0]?.error).toBe('axe-core timed out after 30000ms')
    expect(doc.pages[0]?.passes).toEqual([])
    expect(doc.summary.pagesNotAudited).toBe(1)
  })

  it('uses null for pages that audited fine', () => {
    expect(page(report, 'index.html').error).toBeNull()
  })
})

describe('rule index', () => {
  it('resolves every rule id referenced anywhere in the document', () => {
    const referenced = new Set<string>()
    for (const doc of report.pages) {
      for (const finding of doc.violations) referenced.add(finding.ruleId)
      for (const finding of doc.incomplete) referenced.add(finding.ruleId)
      for (const ruleId of doc.passes) referenced.add(ruleId)
      for (const ruleId of doc.inapplicable) referenced.add(ruleId)
    }

    for (const ruleId of referenced) {
      expect(report.rules).toHaveProperty(ruleId)
    }
    expect(Object.keys(report.rules).length).toBe(referenced.size)
  })

  it('carries the standards mapping for each rule', () => {
    expect(report.rules['image-alt']?.successCriteria).toEqual(['1.1.1'])
    expect(report.rules['image-alt']?.en301549).toEqual(['9.1.1.1'])
    expect(report.rules['image-alt']?.helpUrl).toContain('dequeuniversity.com')
  })

  it('is sorted by rule id', () => {
    const keys = Object.keys(report.rules)

    expect(keys).toEqual([...keys].sort())
  })
})

describe('summary', () => {
  it('counts pages, violations and elements', () => {
    expect(report.summary.pages).toBe(5)
    expect(report.summary.pagesWithViolations).toBe(1)
    expect(report.summary.violations).toBe(3)
    expect(report.summary.violatingElements).toBe(3)
  })

  it('breaks violations down by impact', () => {
    expect(report.summary.byImpact).toEqual({
      critical: 1,
      serious: 2,
      moderate: 0,
      minor: 0,
      unclassified: 0,
    })
  })

  it('reports the threshold and what it would fail on', () => {
    expect(report.summary.failOn).toBe('serious')
    expect(report.summary.failing).toBe(3)

    const lenient = buildJsonReport(audits, {
      directory: './dist',
      failOn: 'critical',
      now: NOW,
    })
    expect(lenient.summary.failing).toBe(1)
  })

  it('keeps review, unevaluated, passed and inapplicable counts apart', () => {
    const { needsReview, notEvaluated, passes, inapplicable } = report.summary

    expect(needsReview).toBeGreaterThan(0)
    expect(notEvaluated).toBeGreaterThan(0)
    expect(passes).toBeGreaterThan(0)
    expect(inapplicable).toBeGreaterThan(0)
  })
})

describe('stability of the contract', () => {
  it('omits machine-specific and non-deterministic detail', () => {
    // Absolute paths leak the build machine into anything committed, timings
    // make two reports of the same build differ, and raw axe-core tags would
    // tie this schema to theirs.
    const serialised = serialiseJsonReport(report)

    expect(serialised).not.toContain('absolutePath')
    expect(serialised).not.toContain('durationMs')
    expect(serialised).not.toContain('"tags"')
    expect(serialised).not.toContain('wcag2aa')
  })

  it('produces byte-identical output for the same run', () => {
    expect(serialiseJsonReport(build())).toBe(serialiseJsonReport(build()))
  })

  it('sorts pages and findings so reports diff cleanly', () => {
    const paths = report.pages.map((doc) => doc.path)
    expect(paths).toEqual([...paths].sort())

    for (const doc of report.pages) {
      const ruleIds = doc.violations.map((finding) => finding.ruleId)
      expect(ruleIds).toEqual([...ruleIds].sort())
      expect(doc.passes).toEqual([...doc.passes].sort())
      expect(doc.inapplicable).toEqual([...doc.inapplicable].sort())
    }
  })

  it('serialises as indented JSON with a trailing newline', () => {
    const serialised = serialiseJsonReport(report)

    expect(serialised.endsWith('}\n')).toBe(true)
    expect(serialised).toContain('\n  "schemaVersion": 1')
    expect(JSON.parse(serialised)).toEqual(report)
  })

  it('holds rule metadata once, not per page', () => {
    const serialised = serialiseJsonReport(report)
    const helpText = 'Images must have alternative text'

    expect(serialised.split(helpText).length - 1).toBe(1)
  })
})

describe('the target block', () => {
  it('says what was audited and which kind it is', () => {
    const report = buildJsonReport(audits, { directory: './dist', failOn: 'serious', now: NOW })

    expect(report.target).toMatchObject({
      source: './dist',
      kind: 'directory',
      directory: './dist',
    })
  })

  it('never puts a URL in directory', () => {
    // schemaVersion 1 documented `directory` as the build directory. A field
    // that quietly started holding something else would break exactly the
    // consumers the version number exists to protect, so a crawl leaves it
    // null and says what it was through `source` and `kind` instead.
    const report = buildJsonReport(audits, {
      directory: 'http://localhost:3000',
      sourceKind: 'url',
      failOn: 'serious',
      now: NOW,
    })

    expect(report.target.directory).toBeNull()
    expect(report.target).toMatchObject({ source: 'http://localhost:3000', kind: 'url' })
  })

  it('keeps schemaVersion 1, because no v1 report could have looked different', () => {
    // Adding fields does not move the version. `directory` becoming nullable
    // only shows up for crawls, which did not exist under v1 at all, so every
    // report shape a v1 consumer could already receive is unchanged.
    const report = buildJsonReport(audits, {
      directory: 'http://localhost:3000',
      sourceKind: 'url',
      failOn: 'serious',
      now: NOW,
    })

    expect(report.schemaVersion).toBe(1)
  })
})
