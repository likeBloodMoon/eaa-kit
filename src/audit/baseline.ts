import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as s from '../schema.ts'
import { elementFingerprint } from './fingerprint.ts'
import { type Finding, type FindingNode, findingElements, type PageAudit } from './result.ts'

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

const entrySchema = s.object({
  /** Page path relative to the audited directory, POSIX separators. */
  page: s.string(),
  ruleId: s.string(),
  /** Identity of the element, from elementFingerprint. */
  fingerprint: s.string(),
  /** Carried for readability only; matching never looks at these. */
  selector: s.withDefault(s.string(), () => ''),
  help: s.withDefault(s.string(), () => ''),
  impact: s.withDefault(s.nullable(s.string()), () => null),
  /** ISO date the entry was written. */
  acceptedOn: s.withDefault(s.string(), () => ''),
  /** ISO date after which this entry stops suppressing anything. */
  expiresOn: s.optional(s.isoDate()),
  /** Why this is being lived with. Free text, for whoever reads the file. */
  note: s.optional(s.string()),
})

const baselineSchema = s.object({
  schemaVersion: s.number(),
  createdOn: s.withDefault(s.string(), () => ''),
  entries: s.withDefault(s.array(entrySchema), () => []),
})

export type BaselineEntry = s.Infer<typeof entrySchema>
export type Baseline = s.Infer<typeof baselineSchema>

export class BaselineError extends Error {
  override readonly name = 'BaselineError'
}

/** What applying a baseline to a run did. */
export interface BaselineOutcome {
  /** Audits with accepted violations moved out of `violations`. */
  audits: PageAudit[]
  /**
   * Entries whose page was audited and whose element was not found: fixed, or
   * moved within the page. Entries for pages this run did not audit are not
   * here — nothing was learned about them.
   */
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
  const expired: BaselineEntry[] = []
  const live = new Map<string, BaselineEntry>()
  for (const entry of baseline.entries) {
    if (entry.expiresOn !== undefined && entry.expiresOn < today) expired.push(entry)
    else live.set(key(entry.page, entry.ruleId, entry.fingerprint), entry)
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

  // Only pages this run actually looked at can produce a stale entry. A run
  // narrowed by --include leaves every other page unaudited, and calling those
  // entries stale would tell somebody to delete the ones protecting the rest of
  // the site — after which the next full run goes red for reasons the tool just
  // advised them to create.
  //
  // The cost is that a page deleted from the site keeps its entries, because
  // from here a deleted page and a page nobody audited look identical. A few
  // dead entries are a much smaller problem than advice that would empty the
  // file.
  const audited = new Set(audits.map((audit) => audit.relativePath))
  const stale = [...live.entries()]
    .filter(([id, entry]) => !matched.has(id) && audited.has(entry.page))
    .map(([, entry]) => entry)
    .sort(byEntry)

  return { audits: next, stale, expired: expired.sort(byEntry), accepted }
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
      for (const node of findingElements(finding)) {
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

  const result = s.safeParse(baselineSchema, value)
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
  // NUL, because a page path can contain any other byte and a delimiter
  // that can appear inside a component is a collision waiting to happen.
  // Written as an escape: a raw control byte makes this file binary to
  // grep, diff and review tools.
  return `${page}\u0000${ruleId}\u0000${fingerprint}`
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
