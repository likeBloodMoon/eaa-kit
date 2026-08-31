import axe from 'axe-core'
import { TOOL_VERSION } from '../../version.ts'
import type { RunCompleteness } from '../completeness.ts'
import { elementFingerprint } from '../fingerprint.ts'
import { countAtOrAbove, type ImpactLevel, impactLabel, isImpactLevel } from '../impact.ts'
import { ruleOutcomes } from '../result.ts'
import type { Finding, IncompleteFinding, PageAudit } from '../runners/jsdom.ts'

/**
 * Bumped only when an existing field is removed, renamed, or changes meaning.
 * Adding a new field does not bump it, so consumers must ignore fields they do
 * not know. See the JSON report contract in the README.
 */
export const SCHEMA_VERSION = 1

export type ReportEngine = 'jsdom' | 'browser'

/**
 * Rule metadata, held once in the document's `rules` map and referenced by id
 * everywhere else. Repeating it inline made 84% of a real report identical
 * copies of the same few dozen rules, 3 MB for a 200-page site.
 */
export interface JsonRule {
  help: string
  helpUrl: string
  /** WCAG success criteria, e.g. ['1.1.1']. */
  successCriteria: string[]
  /** EN 301 549 clauses, e.g. ['9.1.1.1']. */
  en301549: string[]
}

export interface JsonNode {
  html: string
  /** CSS selector path to the element. */
  target: string[]
  failureSummary: string | null
  /**
   * Stable identity of this element: rule, selector and markup, never the page.
   *
   * The same value the baseline file records and SARIF sends as a partial
   * fingerprint, so all three agree on what one defect is. Emitted so a
   * consumer comparing two reports need not reimplement the hash and risk
   * disagreeing with the tools that already use it.
   */
  fingerprint: string
}

export interface JsonFinding {
  /** Key into the document's `rules` map. */
  ruleId: string
  impact: ImpactLevel | null
  nodes: JsonNode[]
}

export interface JsonIncomplete extends JsonFinding {
  /** 'needs-review' wants a human; 'engine-limitation' means no verdict here. */
  reason: 'needs-review' | 'engine-limitation'
  reasonDetail: string
}

export interface JsonPage {
  /** Path relative to the audited directory, POSIX separators. */
  path: string
  url: string
  violations: JsonFinding[]
  incomplete: JsonIncomplete[]
  /**
   * Violations an eaa-kit baseline accounts for. Still violations, and never
   * counted in `violations` or `summary.failing`. Absent when no baseline was
   * used.
   */
  accepted?: JsonFinding[]
  /** Rule ids that were checked and met here. Keys into `rules`. */
  passes: string[]
  /** Rule ids with nothing to check here. Keys into `rules`. Never evidence. */
  inapplicable: string[]
  /** Non-null when the page could not be audited; all four arrays are empty. */
  error: string | null
}

export interface JsonSummary {
  pages: number
  pagesWithViolations: number
  pagesNotAudited: number
  /** Violations counted once per rule per page. */
  violations: number
  /** Individual elements those violations point at. */
  violatingElements: number
  byImpact: Record<ImpactLevel | 'unclassified', number>
  needsReview: number
  notEvaluated: number
  /** Rules that were checked and met, summed over pages. Not a score. */
  passes: number
  /** Rules with nothing to check, summed over pages. Never evidence. */
  inapplicable: number
  failOn: ImpactLevel
  /** Violations at or above `failOn`. Non-zero means the CLI exits 1. */
  failing: number
  /** Violating elements a baseline accepted. 0 when no baseline was used. */
  accepted: number
}

export interface JsonReport {
  schemaVersion: number
  tool: { name: string; version: string; axeCore: string }
  /** ISO 8601, UTC. */
  generatedAt: string
  engine: ReportEngine
  target: {
    /**
     * What was audited: a build directory, or the URL a crawl started from.
     * Read this rather than `directory`, which cannot say which it is.
     */
    source: string
    /** Which of the two `source` is. */
    kind: 'directory' | 'url'
    /**
     * The build directory, or null when the pages were crawled.
     *
     * Kept for consumers written against schemaVersion 1, where this field was
     * the only one there. It never holds a URL: a field that changed meaning
     * without the version moving would break exactly the consumers the version
     * exists to protect.
     */
    directory: string | null
    baseUrl: string | null
  }
  summary: JsonSummary
  /**
   * What this run measured, and what it did not reach.
   *
   * `summary` counts the pages that were audited. This says whether those were
   * all the pages there are, which no other field can answer: a crawl stopped
   * at its limit and a complete one produce identical summaries. Read
   * `completeness.complete` before drawing any conclusion from the counts.
   */
  completeness: RunCompleteness
  /** Every rule id appearing anywhere in the document, sorted by id. */
  rules: Record<string, JsonRule>
  pages: JsonPage[]
}

export interface JsonReportOptions {
  /** What was audited: a build directory, or a crawl's entry URL. */
  directory: string
  /** Which of the two `directory` holds. Defaults to a directory. */
  sourceKind?: 'directory' | 'url'
  failOn: ImpactLevel
  /** What the run did and did not manage to measure. */
  completeness: RunCompleteness
  baseUrl?: string
  /** Injectable so tests and snapshots are not time-dependent. */
  now?: Date
}

/**
 * Build the machine-readable report.
 *
 * This is a published contract, so it deliberately excludes things the internal
 * PageAudit carries: absolute filesystem paths (machine-specific, and they leak
 * into anything committed), per-page timings (non-deterministic, which would
 * make two reports of the same build differ), and raw axe-core tags (they move
 * between axe-core releases, and promising them would tie this schema to
 * theirs). Everything present here is meant to survive.
 */
export function buildJsonReport(
  audits: readonly PageAudit[],
  options: JsonReportOptions,
): JsonReport {
  const generatedAt = (options.now ?? new Date()).toISOString()

  return {
    schemaVersion: SCHEMA_VERSION,
    tool: { name: 'eaa-kit', version: TOOL_VERSION, axeCore: axe.version },
    generatedAt,
    engine: audits[0]?.engine ?? 'jsdom',
    target: {
      source: options.directory,
      kind: options.sourceKind ?? 'directory',
      directory: (options.sourceKind ?? 'directory') === 'directory' ? options.directory : null,
      baseUrl: options.baseUrl ?? null,
    },
    summary: buildSummary(audits, options.failOn),
    completeness: options.completeness,
    rules: buildRuleIndex(audits),
    pages: audits.map(toJsonPage),
  }
}

/** Every rule mentioned by any page, keyed by id and sorted for stable diffs. */
function buildRuleIndex(audits: readonly PageAudit[]): Record<string, JsonRule> {
  const index = new Map<string, JsonRule>()

  for (const audit of audits) {
    for (const outcome of ruleOutcomes(audit)) {
      if (index.has(outcome.ruleId)) continue
      index.set(outcome.ruleId, {
        help: outcome.help,
        helpUrl: outcome.helpUrl,
        successCriteria: outcome.successCriteria,
        en301549: outcome.enClauses,
      })
    }
  }

  return Object.fromEntries([...index].sort(([a], [b]) => a.localeCompare(b)))
}

/** Serialised form written to stdout or to --output, with a trailing newline. */
export function serialiseJsonReport(report: JsonReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

/** The run's tally, exported so the HTML report reads the same numbers. */
export function buildSummary(audits: readonly PageAudit[], failOn: ImpactLevel): JsonSummary {
  const byImpact: Record<ImpactLevel | 'unclassified', number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    unclassified: 0,
  }

  let violations = 0
  let violatingElements = 0
  let needsReview = 0
  let notEvaluated = 0
  let passes = 0
  let inapplicable = 0
  let accepted = 0

  for (const audit of audits) {
    for (const finding of audit.accepted ?? []) accepted += finding.nodes.length
    for (const finding of audit.violations) {
      violations += 1
      violatingElements += finding.nodes.length
      byImpact[impactLabel(finding.impact)] += 1
    }
    for (const finding of audit.incomplete) {
      if (finding.reason === 'engine-limitation') notEvaluated += 1
      else needsReview += 1
    }
    passes += audit.passes.length
    inapplicable += audit.inapplicable.length
  }

  return {
    pages: audits.length,
    pagesWithViolations: audits.filter((audit) => audit.violations.length > 0).length,
    pagesNotAudited: audits.filter((audit) => audit.error).length,
    violations,
    violatingElements,
    byImpact,
    needsReview,
    notEvaluated,
    passes,
    inapplicable,
    failOn,
    failing: countAtOrAbove(audits, failOn),
    accepted,
  }
}

function toJsonPage(audit: PageAudit): JsonPage {
  return {
    path: audit.relativePath,
    url: audit.url,
    violations: [...audit.violations].sort(byRuleId).map(toJsonFinding),
    ...(audit.accepted ? { accepted: [...audit.accepted].sort(byRuleId).map(toJsonFinding) } : {}),
    incomplete: [...audit.incomplete].sort(byRuleId).map(toJsonIncomplete),
    passes: [...audit.passes].sort(byRuleId).map((outcome) => outcome.ruleId),
    inapplicable: [...audit.inapplicable].sort(byRuleId).map((outcome) => outcome.ruleId),
    error: audit.error ?? null,
  }
}

function toJsonFinding(finding: Finding): JsonFinding {
  return {
    ruleId: finding.ruleId,
    impact: finding.impact && isImpactLevel(finding.impact) ? finding.impact : null,
    nodes: finding.nodes.map((node) => ({
      html: node.html,
      target: node.target,
      failureSummary: node.failureSummary ?? null,
      fingerprint: elementFingerprint(finding.ruleId, node.target.join(' '), node.html),
    })),
  }
}

function toJsonIncomplete(finding: IncompleteFinding): JsonIncomplete {
  return {
    ...toJsonFinding(finding),
    reason: finding.reason,
    reasonDetail: finding.reasonDetail,
  }
}

function byRuleId(a: { ruleId: string }, b: { ruleId: string }): number {
  return a.ruleId.localeCompare(b.ruleId)
}
