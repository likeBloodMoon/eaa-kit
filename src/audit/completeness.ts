import type { PageAudit } from './result.ts'

/**
 * Whether a run measured everything it set out to.
 *
 * Every other number in a report describes the pages that were audited. None of
 * them describes the pages that were not, and the difference is the one thing a
 * reader cannot recover for themselves: a crawl that fetched twelve pages of a
 * two-hundred-page site and failed forty URLs produced a report byte-identical
 * to a complete one, because the counts that would have said so were written to
 * stderr and then dropped.
 *
 * That is the same mistake this codebase refuses everywhere else. `passes` is
 * kept apart from `inapplicable` so an empty page cannot look like a compliant
 * one; a rule the engine is blind to is reported as unevaluated rather than as
 * a pass. A clean verdict over a fraction of a site is the same class of false
 * assurance, and it is the one that was still being given.
 *
 * So the facts the collection stage already knew are carried through to the
 * report instead: how the pages were found, how many were missed, and whether
 * the run stopped early. Exit codes are deliberately untouched — an incomplete
 * run is not a violation, and failing builds on it would be a breaking change
 * to every pipeline already running this tool.
 */

/** How the pages that were audited came to be found. */
export type Discovery = 'directory' | 'sitemap' | 'links'

/** Something known to exist that this run never reached a verdict on. */
export interface Unmeasured {
  /** A URL for a crawl, a path relative to the build for a directory. */
  location: string
  reason: string
}

/**
 * What the collection stage found, and what it could not get.
 *
 * Produced before anything is audited, by whichever collector ran, and handed
 * to the report unchanged.
 */
export interface Collection {
  discovery: Discovery
  /** Pages collected and handed to the engine. */
  collected: number
  /** Pages known to exist that could not be collected at all. */
  unreachable: Unmeasured[]
  /** True when collection stopped at a limit rather than running out of pages. */
  truncated: boolean
}

/** A collection that reached everything it knew about. */
export function completeCollection(discovery: Discovery, collected: number): Collection {
  return { discovery, collected, unreachable: [], truncated: false }
}

/** What a finished run did and did not measure. */
export interface RunCompleteness extends Collection {
  /** Pages the engine reached a verdict on. */
  audited: number
  /**
   * Pages collected and then not audited: a parse failure, or a timeout. They
   * are counted apart from `unreachable` because the markup was in hand and the
   * audit is what failed, which is a different thing to fix.
   */
  errored: number
  /**
   * True when nothing was left unmeasured. False does not mean the run is
   * wrong — only that its findings describe less than the whole site, which a
   * reader has to know before drawing a conclusion from them.
   */
  complete: boolean
}

/**
 * Fold what the collector knew together with what the engine managed.
 *
 * The audits carry the second half: a page with an `error` was collected and
 * then not audited, and is as unmeasured as one that was never fetched.
 */
export function runCompleteness(
  audits: readonly PageAudit[],
  collection: Collection,
): RunCompleteness {
  const errored = audits.filter((audit) => audit.error).length
  return {
    ...collection,
    audited: audits.length - errored,
    errored,
    complete: collection.unreachable.length === 0 && !collection.truncated && errored === 0,
  }
}

/**
 * What was missed, as phrases both reports print.
 *
 * Separate clauses rather than one total, for the same reason the coverage
 * parts are: a page that could not be fetched and a page that could not be
 * parsed are different problems with different fixes, and summing them would
 * name neither.
 */
export function missedParts(completeness: RunCompleteness): string[] {
  const parts: string[] = []
  if (completeness.unreachable.length > 0) {
    parts.push(`${completeness.unreachable.length} could not be reached`)
  }
  if (completeness.errored > 0) parts.push(`${completeness.errored} could not be audited`)
  if (completeness.truncated) parts.push('the run stopped at its page limit')
  return parts
}

/** How the pages were found, in words, for the run details both reports show. */
export function discoveryLabel(discovery: Discovery): string {
  switch (discovery) {
    case 'directory':
      return 'files in the build directory'
    case 'sitemap':
      return 'sitemap.xml and links'
    case 'links':
      return 'links from the entry page'
  }
}
