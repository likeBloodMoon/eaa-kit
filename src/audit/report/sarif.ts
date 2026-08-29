import path from 'node:path'
import type { ImpactValue } from 'axe-core'
import { standardsReference } from '../../text.ts'
import { TOOL_VERSION } from '../../version.ts'
import { elementFingerprint } from '../fingerprint.ts'
import { isImpactLevel } from '../impact.ts'
import { findingElements, ruleOutcomes } from '../result.ts'
import type { Finding, PageAudit, RuleOutcome } from '../runners/jsdom.ts'

export const SARIF_VERSION = '2.1.0'
export const SARIF_SCHEMA =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json'

export type SarifLevel = 'none' | 'note' | 'warning' | 'error'

export interface SarifRule {
  id: string
  shortDescription: { text: string }
  helpUri?: string
  help: { text: string }
  properties: { tags: string[] }
}

/**
 * A result the baseline accounts for.
 *
 * SARIF models this natively, and GitHub code scanning reads it: a suppressed
 * result is shown as closed rather than dropped, which is exactly what an
 * accepted violation is. Emitting them as ordinary results would fail the
 * build the baseline exists to unblock; leaving them out would hide a defect
 * the project has on record.
 */
export interface SarifSuppression {
  kind: 'external'
  justification: string
}

export interface SarifResult {
  ruleId: string
  ruleIndex: number
  level: SarifLevel
  kind: 'fail'
  message: { text: string }
  locations: Array<{
    physicalLocation: { artifactLocation: { uri: string } }
  }>
  partialFingerprints: Record<string, string>
  /** Present only on results an eaa-kit baseline accepted. */
  suppressions?: SarifSuppression[]
}

export interface SarifNotification {
  level: SarifLevel
  message: { text: string }
  locations?: Array<{ physicalLocation: { artifactLocation: { uri: string } } }>
}

export interface SarifLog {
  $schema: string
  version: string
  runs: Array<{
    tool: { driver: { name: string; version: string; rules: SarifRule[] } }
    invocations: Array<{
      executionSuccessful: boolean
      endTimeUtc: string
      toolExecutionNotifications: SarifNotification[]
    }>
    results: SarifResult[]
    properties: Record<string, unknown>
  }>
}

export interface SarifReportOptions {
  /** Directory that was audited, as the user gave it. */
  directory: string
  /** Resolved against this when making artifact URIs repo-relative. */
  cwd?: string
  now?: Date
}

/**
 * Map axe-core's impact onto SARIF's level.
 *
 * An unclassified impact becomes `error` rather than something quieter: a
 * missing impact is a gap in what we know, and the rest of the tool already
 * refuses to wave those through (see meetsThreshold).
 */
export function toSarifLevel(impact: ImpactValue): SarifLevel {
  if (impact === null || !isImpactLevel(impact)) return 'error'
  switch (impact) {
    case 'critical':
    case 'serious':
      return 'error'
    case 'moderate':
      return 'warning'
    case 'minor':
      return 'note'
  }
}

/**
 * SARIF 2.1.0 log for GitHub code scanning.
 *
 * Only violations become results. incomplete findings are deliberately left
 * out: "a human must look at this" and "this engine is blind here" are not
 * defects at a source location, and filing thousands of them as alerts would
 * bury the failures that are real. The counts are kept in `run.properties` so
 * the information survives in the artifact, and the JSON format carries them in
 * full.
 */
export function buildSarifReport(
  audits: readonly PageAudit[],
  options: SarifReportOptions,
): SarifLog {
  const rules = buildRules(audits)
  const ruleIndex = new Map(rules.map((rule, index) => [rule.id, index]))
  const cwd = options.cwd ?? process.cwd()

  const results: SarifResult[] = []
  const notifications: SarifNotification[] = []

  for (const audit of audits) {
    const uri = artifactUri(options.directory, audit.relativePath, cwd)

    if (audit.error) {
      notifications.push({
        level: 'error',
        message: { text: `Page could not be audited: ${audit.error}` },
        locations: [{ physicalLocation: { artifactLocation: { uri } } }],
      })
      continue
    }

    for (const finding of audit.violations) {
      const index = ruleIndex.get(finding.ruleId)
      if (index === undefined) continue
      results.push(...toResults(finding, index, uri))
    }

    for (const finding of audit.accepted ?? []) {
      const index = ruleIndex.get(finding.ruleId)
      if (index === undefined) continue
      results.push(...toResults(finding, index, uri, SUPPRESSED))
    }
  }

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: { driver: { name: 'eaa-kit', version: TOOL_VERSION, rules } },
        invocations: [
          {
            executionSuccessful: notifications.length === 0,
            endTimeUtc: (options.now ?? new Date()).toISOString(),
            toolExecutionNotifications: notifications,
          },
        ],
        results,
        properties: summaryProperties(audits),
      },
    ],
  }
}

export function serialiseSarifReport(log: SarifLog): string {
  return `${JSON.stringify(log, null, 2)}\n`
}

/**
 * One result per offending element, not per rule: a SARIF result carries a
 * single primary location, and one alert per element is what a reviewer acts
 * on. A violation that reported no elements still gets one result on the page.
 */
const SUPPRESSED: SarifSuppression[] = [
  { kind: 'external', justification: 'Recorded in the eaa-kit baseline' },
]

function toResults(
  finding: Finding,
  ruleIndex: number,
  uri: string,
  suppressions?: SarifSuppression[],
): SarifResult[] {
  const level = toSarifLevel(finding.impact)
  const location = { physicalLocation: { artifactLocation: { uri } } }

  return findingElements(finding).map(({ selector, html }) => ({
    ruleId: finding.ruleId,
    ruleIndex,
    level,
    kind: 'fail',
    message: { text: selector === '' ? finding.help : `${finding.help}. Element: ${selector}` },
    locations: [location],
    partialFingerprints: fingerprint(finding.ruleId, selector, html),
    ...(suppressions ? { suppressions } : {}),
  }))
}

/**
 * Identifies an alert across runs. Deliberately excludes the file path, so that
 * moving a page does not close one alert and open an identical one; GitHub
 * combines the fingerprint with the location itself.
 */
function fingerprint(ruleId: string, selector: string, html: string): Record<string, string> {
  return { 'eaaKit/v1': elementFingerprint(ruleId, selector, html) }
}

/** Every rule the run knows about, so the catalogue is complete in GitHub. */
function buildRules(audits: readonly PageAudit[]): SarifRule[] {
  const rules = new Map<string, SarifRule>()

  for (const audit of audits) {
    for (const outcome of ruleOutcomes(audit)) {
      if (rules.has(outcome.ruleId)) continue
      rules.set(outcome.ruleId, toSarifRule(outcome))
    }
  }

  return [...rules.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function toSarifRule(outcome: RuleOutcome): SarifRule {
  const references = standardsReference(outcome.successCriteria, outcome.enClauses)

  return {
    id: outcome.ruleId,
    shortDescription: { text: outcome.help },
    ...(outcome.helpUrl ? { helpUri: outcome.helpUrl } : {}),
    help: { text: references ? `${outcome.help}\n\n${references}` : outcome.help },
    properties: {
      tags: [
        'accessibility',
        ...outcome.successCriteria.map((criterion) => `wcag-${criterion}`),
        ...outcome.enClauses.map((clause) => `en-301-549-${clause}`),
      ],
    },
  }
}

/**
 * Coverage that has no place in `results` but should not vanish: a SARIF log
 * with no results must not be mistaken for "everything was checked".
 */
function summaryProperties(audits: readonly PageAudit[]): Record<string, unknown> {
  let needsReview = 0
  let notEvaluated = 0
  const notEvaluatedRules = new Set<string>()

  for (const audit of audits) {
    for (const finding of audit.incomplete) {
      if (finding.reason === 'engine-limitation') {
        notEvaluated += 1
        notEvaluatedRules.add(finding.ruleId)
      } else {
        needsReview += 1
      }
    }
  }

  return {
    engine: audits[0]?.engine ?? 'jsdom',
    pages: audits.length,
    needsReview,
    notEvaluated,
    notEvaluatedRules: [...notEvaluatedRules].sort(),
  }
}

/**
 * Artifact URIs are relative to the working directory and POSIX-separated, so
 * GitHub can line them up with files in the repository.
 */
function artifactUri(directory: string, relativePath: string, cwd: string): string {
  const absolute = path.resolve(cwd, directory, relativePath)
  const relative = path.relative(cwd, absolute)

  // A build directory outside the repository cannot be made repo-relative;
  // fall back to the page path rather than emitting ../.. or a local absolute
  // path that means nothing on the CI machine.
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return relativePath
  }
  return relative.split(path.sep).join('/')
}
