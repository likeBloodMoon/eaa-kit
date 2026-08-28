import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { elementFingerprint } from './fingerprint.ts'
import type { Finding, FindingNode, PageAudit } from './result.ts'

/**
 * A record of the violations a project has decided to live with for now.
 *
 * Every build-time linter that fails a build needs one of these, or it cannot
 * be adopted on a site that already exists: a first run on a real client site
 * finds dozens of violations, the build goes red, and the only ways out are to
 * fix everything before merging anything or to turn the tool off. A baseline is
 * the third way — fail on what is new, and keep a written record of what is
 * not.
 *
 * It is designed so that it cannot quietly become an excuse:
 *
 * - An accepted violation is still reported. It moves out of the count that
 *   fails the build and into a section of its own; it never becomes a pass, and
 *   it is never simply absent.
 * - Matching is exact. A baseline suppresses the element it was recorded
 *   against and nothing else, so a new violation of an already-accepted rule
 *   still fails the run.
 * - Entries that no longer match are reported as stale, so a baseline shrinks
 *   as things are fixed rather than rotting.
 * - An entry may carry an expiry date, after which it stops suppressing
 *   anything. Nothing here is permanent unless somebody keeps deciding it is.
 */

/** Bumped only when an existing field is removed, renamed, or changes meaning. */
export const BASELINE_SCHEMA_VERSION = 1

/** Default filename, used by the CLI when no path is given. */
export const DEFAULT_BASELINE_FILE = 'eaa-baseline.json'

const entrySchema = z.object({
  /** Page path relative to the audited directory, POSIX separators. */
  page: z.string(),
  ruleId: z.string(),
  /** Identity of the element, from elementFingerprint. */
  fingerprint: z.string(),
  /** Carried for readability only; matching never looks at these. */
  selector: z.string().default(''),
  help: z.string().default(''),
  impact: z.string().nullable().default(null),
  /** ISO date the entry was written. */
  acceptedOn: z.string().default(''),
  /** ISO date after which this entry stops suppressing anything. */
  expiresOn: z.iso.date().optional(),
  /** Why this is being lived with. Free text, for whoever reads the file. */
  note: z.string().optional(),
})

const baselineSchema = z.object({
  schemaVersion: z.number(),
  createdOn: z.string().default(''),
  entries: z.array(entrySchema).default([]),
})

export type BaselineEntry = z.output<typeof entrySchema>
export type Baseline = z.output<typeof baselineSchema>

export class BaselineError extends Error {
  override readonly name = 'BaselineError'
}

/** What applying a baseline to a run did. */
export interface BaselineOutcome {
  /** Audits with accepted violations moved out of `violations`. */
  audits: PageAudit[]
  /** Entries that matched nothing this run: fixed, or the page moved. */
  stale: BaselineEntry[]
  /** Entries past their expiry date. They suppressed nothing. */
  expired: BaselineEntry[]
  /** Violating elements this run accepted. */
  accepted: number
}

export interface ApplyBaselineOptions {
  /** Injectable so expiry can be tested without waiting. Defaults to today. */
  today?: Date
}

/**
 * Move the violations a baseline accounts for out of the failing set.
 *
 * Returns new audit objects; the ones passed in are not touched, so a caller
 * can still report on what the run actually found.
 */
export function applyBaseline(
  audits: readonly PageAudit[],
  baseline: Baseline,
  options: ApplyBaselineOptions = {},
): BaselineOutcome {
  const today = isoDate(options.today ?? new Date())
  const expired = baseline.entries.filter(
    (entry) => entry.expiresOn !== undefined && entry.expiresOn < today,
  )
  const live = new Map<string, BaselineEntry>()
  for (const entry of baseline.entries) {
    if (entry.expiresOn !== undefined && entry.expiresOn < today) continue
    live.set(key(entry.page, entry.ruleId, entry.fingerprint), entry)
  }

  const matched = new Set<string>()
  let accepted = 0

  const next = audits.map((audit) => {
    const violations: Finding[] = []
    const acceptedFindings: Finding[] = []

    for (const finding of audit.violations) {
      const kept: FindingNode[] = []
      const waived: FindingNode[] = []

      for (const node of finding.nodes) {
        const id = key(
          audit.relativePath,
          finding.ruleId,
          elementFingerprint(finding.ruleId, node.target.join(' '), node.html),
        )
        if (live.has(id)) {
          matched.add(id)
          waived.push(node)
        } else {
          kept.push(node)
        }
      }

      // A rule with no nodes at all cannot be matched element by element, so it
      // is accepted only if the baseline holds an entry for the rule on this
      // page with the empty fingerprint the writer records for that case.
      if (finding.nodes.length === 0) {
        const id = key(
          audit.relativePath,
          finding.ruleId,
          elementFingerprint(finding.ruleId, '', ''),
        )
        if (live.has(id)) {
          matched.add(id)
          acceptedFindings.push(finding)
          continue
        }
        violations.push(finding)
        continue
      }

      if (waived.length > 0) {
        accepted += waived.length
        acceptedFindings.push({ ...finding, nodes: waived })
      }
      // A rule that failed on five elements of which three are accepted is
      // still a failing rule on the other two.
      if (kept.length > 0) violations.push({ ...finding, nodes: kept })
    }

    return {
      ...audit,
      violations,
      ...(acceptedFindings.length > 0 ? { accepted: acceptedFindings } : {}),
    }
  })

  const stale = [...live.entries()]
    .filter(([id]) => !matched.has(id))
    .map(([, entry]) => entry)
    .sort(byEntry)

  return { audits: next, stale, expired: [...expired].sort(byEntry), accepted }
}

export interface BuildBaselineOptions {
  /** ISO date recorded on every entry. Defaults to today. */
  today?: Date
  /** Written onto every entry, for whoever reads the file later. */
  note?: string
  /** ISO date after which the entries stop suppressing anything. */
  expiresOn?: string
}

/** Record every violation a run found, so a later run can fail only on new ones. */
export function buildBaseline(
  audits: readonly PageAudit[],
  options: BuildBaselineOptions = {},
): Baseline {
  const acceptedOn = isoDate(options.today ?? new Date())
  const entries: BaselineEntry[] = []

  for (const audit of audits) {
    for (const finding of audit.violations) {
      const nodes: Array<{ selector: string; html: string }> =
        finding.nodes.length > 0
          ? finding.nodes.map((node) => ({ selector: node.target.join(' '), html: node.html }))
          : [{ selector: '', html: '' }]

      for (const node of nodes) {
        entries.push({
          page: audit.relativePath,
          ruleId: finding.ruleId,
          fingerprint: elementFingerprint(finding.ruleId, node.selector, node.html),
          selector: node.selector,
          help: finding.help,
          impact: finding.impact ?? null,
          acceptedOn,
          ...(options.expiresOn ? { expiresOn: options.expiresOn } : {}),
          ...(options.note ? { note: options.note } : {}),
        })
      }
    }
  }

  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    createdOn: acceptedOn,
    entries: entries.sort(byEntry),
  }
}

/** Serialised form, with a trailing newline, sorted so it diffs cleanly. */
export function serialiseBaseline(baseline: Baseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`
}

export async function readBaseline(file: string, cwd = process.cwd()): Promise<Baseline> {
  const target = path.resolve(cwd, file)
  let raw: string
  try {
    raw = await readFile(target, 'utf8')
  } catch {
    throw new BaselineError(
      `Could not read the baseline at ${file}. Create one with: eaa-kit baseline`,
    )
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    throw new BaselineError(
      `${path.basename(target)} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  const result = baselineSchema.safeParse(value)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`)
      .slice(0, 5)
    throw new BaselineError(
      `${path.basename(target)} is not an eaa-kit baseline (${issues.join('; ')})`,
    )
  }
  if (result.data.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    throw new BaselineError(
      `${path.basename(target)} has schemaVersion ${result.data.schemaVersion}; this version of eaa-kit reads ${BASELINE_SCHEMA_VERSION}`,
    )
  }

  return result.data
}

export async function writeBaseline(
  file: string,
  baseline: Baseline,
  cwd = process.cwd(),
): Promise<string> {
  const target = path.resolve(cwd, file)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, serialiseBaseline(baseline), 'utf8')
  return target
}

function key(page: string, ruleId: string, fingerprint: string): string {
  return `${page} ${ruleId} ${fingerprint}`
}

function byEntry(a: BaselineEntry, b: BaselineEntry): number {
  return (
    a.page.localeCompare(b.page) ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.fingerprint.localeCompare(b.fingerprint)
  )
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}
