import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as s from '../schema.ts'
import { elementFingerprint } from './fingerprint.ts'
import { type ImpactLevel, impactRank, isImpactLevel } from './impact.ts'

/**
 * What changed between two runs.
 *
 * A baseline is a committed record of the violations a project has decided to
 * live with. This is the other question: not "what do we tolerate" but "what
 * did this change do". It needs no file in the repository and no decision from
 * anybody — two reports, and the difference between them.
 *
 * Identity comes from `elementFingerprint`, the same function the baseline and
 * SARIF use, so all three agree on what one defect is. A violation that moved
 * to another page is the same violation; a violation whose markup changed is a
 * different one, which is the conservative reading and the one that avoids
 * quietly calling something fixed.
 *
 * The refusal that matters is `unmeasured`. A violation missing from the second
 * run has two possible explanations — somebody fixed it, or nothing looked at
 * that page — and they are not interchangeable. Reporting the second as
 * "fixed" would turn a crawl that stopped early into a changelog of work
 * nobody did, which is exactly the false assurance the completeness block
 * exists to prevent. So a violation is only called fixed when the later run
 * actually audited the page it was on.
 */

/** Reports older than this cannot be compared. */
export const SUPPORTED_REPORT_SCHEMA = 2

export class DiffError extends Error {
  override readonly name = 'DiffError'
}

/**
 * Only the fields a comparison reads. `completeness` is optional: a report
 * written before it existed says nothing about coverage, which is not the same
 * as saying the run was complete, and is handled as the unknown it is.
 */
const reportSchema = s.object({
  schemaVersion: s.number(),
  generatedAt: s.string(),
  target: s.withDefault(s.object({ source: s.withDefault(s.string(), () => '') }), () => ({
    source: '',
  })),
  completeness: s.optional(
    s.object({
      complete: s.boolean(),
      audited: s.withDefault(s.number(), () => 0),
    }),
  ),
  rules: s.withDefault(
    s.record(s.object({ help: s.withDefault(s.string(), () => '') })),
    (): Record<string, { help: string }> => ({}),
  ),
  pages: s.withDefault(
    s.array(
      s.object({
        path: s.string(),
        error: s.withDefault(s.nullable(s.string()), () => null),
        violations: s.withDefault(
          s.array(
            s.object({
              ruleId: s.string(),
              impact: s.withDefault(s.nullable(s.string()), () => null),
              nodes: s.withDefault(
                s.array(
                  s.object({
                    html: s.withDefault(s.string(), () => ''),
                    target: s.withDefault(s.array(s.string()), () => []),
                  }),
                ),
                () => [],
              ),
            }),
          ),
          () => [],
        ),
      }),
    ),
    () => [],
  ),
})

type ParsedReport = s.Infer<typeof reportSchema>

/** One violating element, on one page. */
export interface DiffEntry {
  page: string
  ruleId: string
  /** Identity of the element: rule, selector and markup. Never the page. */
  fingerprint: string
  impact: ImpactLevel | null
  help: string
  selector: string
  html: string
}

/** What a run contributed, for the header both formats print. */
export interface DiffSide {
  /** What was audited, as the report recorded it. */
  source: string
  generatedAt: string
  /** Pages that reached a verdict. */
  audited: number
  /**
   * Whether that run measured everything it knew about. `undefined` for a
   * report written before completeness existed — unknown, not complete.
   */
  complete: boolean | undefined
}

export interface ReportDiff {
  base: DiffSide
  head: DiffSide
  /** In the later run and not the earlier one. */
  added: DiffEntry[]
  /** In the earlier run, gone from the later one, on a page the later run audited. */
  fixed: DiffEntry[]
  /** In both. */
  unchanged: DiffEntry[]
  /**
   * In the earlier run, and on a page the later run never audited. Not fixed
   * and not still failing: nothing looked, so nothing is known.
   */
  unmeasured: DiffEntry[]
}

/**
 * The elements a violation points at.
 *
 * Mirrors `findingElements` for the JSON shape, including its one subtlety: a
 * rule can fail with no element attached, and it still has an identity. Getting
 * this wrong here would make document-level failures invisible to a diff while
 * remaining visible to the baseline.
 */
function elementsOf(violation: ParsedReport['pages'][number]['violations'][number]): Array<{
  selector: string
  html: string
}> {
  if (violation.nodes.length === 0) return [{ selector: '', html: '' }]
  return violation.nodes.map((node) => ({ selector: node.target.join(' '), html: node.html }))
}

/** Every violating element in a report, keyed by page and element identity. */
function entriesOf(report: ParsedReport): Map<string, DiffEntry> {
  const entries = new Map<string, DiffEntry>()

  for (const page of report.pages) {
    for (const violation of page.violations) {
      const impact =
        violation.impact !== null && isImpactLevel(violation.impact) ? violation.impact : null
      for (const { selector, html } of elementsOf(violation)) {
        const fingerprint = elementFingerprint(violation.ruleId, selector, html)
        const key = `${page.path}\n${fingerprint}`
        if (entries.has(key)) continue
        entries.set(key, {
          page: page.path,
          ruleId: violation.ruleId,
          fingerprint,
          impact,
          help: report.rules[violation.ruleId]?.help ?? violation.ruleId,
          selector,
          html,
        })
      }
    }
  }

  return entries
}

/** Pages a run reached a verdict on. A page that errored is not one of them. */
function auditedPages(report: ParsedReport): Set<string> {
  return new Set(report.pages.filter((page) => page.error === null).map((page) => page.path))
}

function sideOf(report: ParsedReport): DiffSide {
  return {
    source: report.target.source,
    generatedAt: report.generatedAt,
    audited: report.completeness?.audited ?? auditedPages(report).size,
    complete: report.completeness?.complete,
  }
}

/** Worst first, then by page, so two runs of one comparison agree. */
function bySeverityThenPage(a: DiffEntry, b: DiffEntry): number {
  return (
    impactRank(a.impact) - impactRank(b.impact) ||
    a.page.localeCompare(b.page) ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.selector.localeCompare(b.selector)
  )
}

/** Compare two parsed reports, earlier first. */
export function diffReports(base: ParsedReport, head: ParsedReport): ReportDiff {
  const before = entriesOf(base)
  const after = entriesOf(head)
  const measuredByHead = auditedPages(head)

  const added: DiffEntry[] = []
  const fixed: DiffEntry[] = []
  const unchanged: DiffEntry[] = []
  const unmeasured: DiffEntry[] = []

  for (const [key, entry] of after) {
    if (before.has(key)) unchanged.push(entry)
    else added.push(entry)
  }

  for (const [key, entry] of before) {
    if (after.has(key)) continue
    // Gone from the report is not the same as gone from the site. Only a page
    // the later run actually audited can testify that the violation is not
    // there any more.
    if (measuredByHead.has(entry.page)) fixed.push(entry)
    else unmeasured.push(entry)
  }

  return {
    base: sideOf(base),
    head: sideOf(head),
    added: added.sort(bySeverityThenPage),
    fixed: fixed.sort(bySeverityThenPage),
    unchanged: unchanged.sort(bySeverityThenPage),
    unmeasured: unmeasured.sort(bySeverityThenPage),
  }
}

/**
 * Read a JSON report from disk.
 *
 * Refuses a schema version it was not written against rather than reading it
 * optimistically: a field that changed meaning is exactly what the version
 * number exists to signal, and a diff built on a misread field would be wrong
 * quietly.
 */
export async function readReport(file: string, cwd = process.cwd()): Promise<ParsedReport> {
  const target = path.resolve(cwd, file)

  let raw: string
  try {
    raw = await readFile(target, 'utf8')
  } catch {
    throw new DiffError(`Report not found: ${file}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new DiffError(`${file} is not valid JSON (${(cause as Error).message})`)
  }

  const result = s.safeParse(reportSchema, parsed)
  if (!result.success) {
    const first = result.error.issues[0]
    const where =
      first === undefined || first.path.length === 0 ? '' : ` at ${first.path.join('.')}`
    throw new DiffError(
      `${file} is not an eaa-kit JSON report${where}: ${first?.message ?? 'unrecognised shape'}`,
    )
  }

  if (result.data.schemaVersion !== SUPPORTED_REPORT_SCHEMA) {
    throw new DiffError(
      `${file} is schemaVersion ${result.data.schemaVersion}; this version of eaa-kit reads ${SUPPORTED_REPORT_SCHEMA}.\n` +
        '  Write both reports with the same version of eaa-kit before comparing them.',
    )
  }

  return result.data
}
