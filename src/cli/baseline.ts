import path from 'node:path'
import pc from 'picocolors'
import {
  BaselineError,
  buildBaseline,
  DEFAULT_BASELINE_FILE,
  writeBaseline,
} from '../audit/baseline.ts'
import type { PageAudit } from '../audit/runners/jsdom.ts'
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

  process.stderr.write(
    pc.dim(`Auditing ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} in ${label}…\n`),
  )

  const effectiveBaseUrl: string | undefined = options.baseUrl ?? origin

  const runnerOptions = {
    ...(effectiveBaseUrl === undefined ? {} : { baseUrl: effectiveBaseUrl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  }

  let audits: PageAudit[]
  if (options.browser) {
    const { BrowserUnavailableError, runBrowserAudit } = await import(
      '../audit/runners/playwright.ts'
    )
    try {
      audits = await runBrowserAudit(
        options.url === undefined ? path.resolve(cwd, dir) : undefined,
        pages,
        runnerOptions,
      )
    } catch (cause) {
      if (cause instanceof BrowserUnavailableError) {
        process.stderr.write(`${pc.red('error')} ${cause.message}\n`)
        return { entries: 0, exitCode: 2 }
      }
      throw cause
    }
  } else {
    const { runPooledAudit } = await import('../audit/runners/pool.ts')
    audits = await runPooledAudit(pages, {
      ...runnerOptions,
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    })
  }

  // A page nothing could read has no violations to record, and writing a
  // baseline from a half-finished run would accept an unknown amount of
  // nothing. The audit command refuses to give a verdict here; so does this.
  const unaudited = audits.filter((audit) => audit.error)
  if (unaudited.length > 0) {
    process.stderr.write(
      `${pc.red('error')} ${unaudited.length} of ${audits.length} pages could not be audited, so no baseline was written\n`,
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
      process.stderr.write(`${pc.red('error')} ${cause.message}\n`)
      return { entries: 0, exitCode: 2 }
    }
    throw cause
  }

  const count = baseline.entries.length
  process.stderr.write(pc.dim(`Wrote ${count} ${count === 1 ? 'entry' : 'entries'} to ${target}\n`))
  if (count > 0) {
    // The file is a list of things that are wrong with the site. Saying so
    // where somebody will read it is the difference between a baseline and a
    // way of turning the tool off.
    process.stderr.write(
      pc.yellow('These are barriers, not exceptions. Commit the file, then work the list down.\n'),
    )
  }

  return { entries: count, exitCode: 0 }
}
