import path from 'node:path'
import pc from 'picocolors'
import {
  BaselineError,
  buildBaseline,
  DEFAULT_BASELINE_FILE,
  writeBaseline,
} from '../audit/baseline.ts'
import { count } from '../text.ts'
import { type CrawlCommandOptions, resolvePages } from './pages.ts'
import { fail, note, runEngine } from './report.ts'

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
  browser?: boolean
  concurrency?: number
  cwd?: string
}

export interface BaselineCommandResult {
  /** Violating elements recorded. */
  entries: number
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
  const { pages, origin, label } = resolved

  note(`Auditing ${count(pages.length, 'page')} in ${label}…`)

  const baseUrl = options.baseUrl ?? origin
  const audits = await runEngine(pages, {
    cwd,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.browser ? { browser: true } : {}),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    ...(options.url === undefined ? { directory: path.resolve(cwd, dir) } : {}),
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

  const baseline = buildBaseline(audits, {
    ...(options.note ? { note: options.note } : {}),
    ...(options.expiresOn ? { expiresOn: options.expiresOn } : {}),
  })

  const target = options.output ?? DEFAULT_BASELINE_FILE
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
  note(`Wrote ${entries} ${entries === 1 ? 'entry' : 'entries'} to ${target}`)
  if (entries > 0) {
    // The file is a list of things that are wrong with the site. Saying so
    // where somebody will read it is the difference between a baseline and a
    // way of turning the tool off.
    process.stderr.write(
      pc.yellow('These are barriers, not exceptions. Commit the file, then work the list down.\n'),
    )
  }

  return { entries, exitCode: 0 }
}
