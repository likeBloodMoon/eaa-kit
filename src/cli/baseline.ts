import path from 'node:path'
import {
  applyBaseline,
  BaselineError,
  buildBaseline,
  DEFAULT_BASELINE_FILE,
  pruneBaseline,
  readBaseline,
  writeBaseline,
} from '../audit/baseline.ts'
import type { PageAudit } from '../audit/runners/jsdom.ts'
import { count } from '../text.ts'
import { advise, fail, note, runEngine } from './command.ts'
import { type CrawlCommandOptions, resolvePages } from './pages.ts'

export interface BaselineCommandOptions extends CrawlCommandOptions {
  include?: string[]
  exclude?: string[]
  baseUrl?: string
  /** Where to write it. Defaults to eaa-baseline.json. */
  output?: string
  /** Recorded on every entry, for whoever reads the file later. */
  note?: string
  /** ISO date after which the entries stop suppressing anything. */
  expiresOn?: string
  /**
   * Remove the entries this run shows are gone, instead of recording a new
   * baseline. Reads and rewrites the file at `output`, adding nothing.
   */
  prune?: boolean
  browser?: boolean
  concurrency?: number
  cwd?: string
}

export interface BaselineCommandResult {
  /** Violating elements recorded, or left in the file after a prune. */
  entries: number
  /** Entries a prune removed. 0 for an ordinary run. */
  removed?: number
  /** 0 written, 2 the baseline could not be produced. */
  exitCode: number
}

/**
 * `eaa-kit baseline [dir]`.
 *
 * Runs the same audit the audit command runs and writes down every violation it
 * found, so that a later run can fail on what is new instead of on everything.
 *
 * Deliberately a subcommand rather than a flag on `audit`. Accepting a set of
 * violations is a decision somebody makes once and commits to a file others
 * will read; folding it into the command that checks them would make it far too
 * easy to type by reflex when a build goes red, which is precisely the moment
 * it should take a deliberate act.
 */
export async function runBaselineCommand(
  dir: string,
  options: BaselineCommandOptions = {},
): Promise<BaselineCommandResult> {
  const cwd = options.cwd ?? process.cwd()

  const resolved = await resolvePages(path.resolve(cwd, dir), { ...options, label: dir })
  if (!resolved) return { entries: 0, exitCode: 2 }
  const { pages, origin, label, directory } = resolved

  note(`Auditing ${count(pages.length, 'page')} in ${label}…`)

  const baseUrl = options.baseUrl ?? origin
  const audits = await runEngine(pages, {
    cwd,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.browser ? { browser: true } : {}),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    // Where the pages were read from, as the collection stage resolved it.
    // Undefined for a crawl, whose pages are audited at their own URL.
    ...(directory === undefined ? {} : { directory }),
  })
  if (!audits) return { entries: 0, exitCode: 2 }

  // A page nothing could read has no violations to record, and writing a
  // baseline from a half-finished run would accept an unknown amount of
  // nothing. The audit command refuses to give a verdict here; so does this.
  const unaudited = audits.filter((audit) => audit.error)
  if (unaudited.length > 0) {
    fail(
      `${unaudited.length} of ${audits.length} pages could not be audited, so no baseline was written`,
    )
    return { entries: 0, exitCode: 2 }
  }

  const target = options.output ?? DEFAULT_BASELINE_FILE

  if (options.prune) return await prune(audits, target, cwd)

  const baseline = buildBaseline(audits, {
    ...(options.note ? { note: options.note } : {}),
    ...(options.expiresOn ? { expiresOn: options.expiresOn } : {}),
  })

  try {
    await writeBaseline(target, baseline, cwd)
  } catch (cause) {
    if (cause instanceof BaselineError) {
      fail(cause.message)
      return { entries: 0, exitCode: 2 }
    }
    throw cause
  }

  const entries = baseline.entries.length
  note(`Wrote ${count(entries, 'entry')} to ${target}`)
  if (entries > 0) {
    // The file is a list of things that are wrong with the site. Saying so
    // where somebody will read it is the difference between a baseline and a
    // way of turning the tool off.
    advise('These are barriers, not exceptions. Commit the file, then work the list down.')
  }

  return { entries, exitCode: 0 }
}

/**
 * `--prune`: take out what this run shows is gone, and add nothing.
 *
 * The audit already tells anybody running it that entries no longer match and
 * can be removed. Acting on that advice meant editing JSON by hand, entry by
 * entry, against a file whose whole purpose is that nobody has to remember what
 * is in it — so most people did not, and a baseline accumulated barriers that
 * were fixed years ago while looking exactly like one that had not been read.
 *
 * Recording a new baseline is not the same operation and is not a substitute:
 * it accepts whatever the site fails today, which on a bad day quietly adopts a
 * barrier nobody agreed to.
 */
async function prune(
  audits: readonly PageAudit[],
  target: string,
  cwd: string,
): Promise<BaselineCommandResult> {
  let existing: Awaited<ReturnType<typeof readBaseline>>
  try {
    existing = await readBaseline(target, cwd)
  } catch (cause) {
    if (cause instanceof BaselineError) {
      fail(cause.message)
      return { entries: 0, exitCode: 2 }
    }
    throw cause
  }

  const outcome = applyBaseline(audits, existing)
  const { baseline, removed } = pruneBaseline(existing, outcome.stale)

  if (removed.length === 0) {
    note(`Nothing to remove from ${target}: every entry still matches something on this run`)
    return { entries: existing.entries.length, removed: 0, exitCode: 0 }
  }

  await writeBaseline(target, baseline, cwd)

  note(
    `Removed ${count(removed.length, 'entry')} from ${target}; ${count(baseline.entries.length, 'entry')} left`,
  )
  for (const entry of removed) note(`  ${entry.page}  ${entry.ruleId}`)
  // Entries on pages this run did not audit are not removable from here, and
  // an expired entry is a decision with a date on it rather than a fixed
  // barrier, so neither is touched. Saying so stops a shorter file being read
  // as a complete one.
  if (outcome.expired.length > 0) {
    advise(
      `${count(outcome.expired.length, 'entry')} have expired and suppress nothing; --prune leaves them for you to decide about`,
    )
  }

  return { entries: baseline.entries.length, removed: removed.length, exitCode: 0 }
}
