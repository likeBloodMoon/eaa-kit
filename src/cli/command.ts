import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pc from 'picocolors'
import type { CollectedPage } from '../audit/collect.ts'
import type { PageAudit } from '../audit/runners/jsdom.ts'

/**
 * What every command does around the audit itself: say what is happening, run
 * the engine, and put the document somewhere.
 *
 * `audit` and `baseline` are siblings — one reports what a run found and the
 * other writes it down — so they take the same flags, choose between the same
 * two engines and fail on the same setup problems. Keeping that in one place is
 * what stops the two commands drifting into disagreeing about what a run is.
 */

/** Progress and diagnostics go to stderr, so the report can be piped away. */
export function note(message: string): void {
  process.stderr.write(pc.dim(`${message}\n`))
}

export function warn(message: string): void {
  process.stderr.write(`${pc.yellow('warning')} ${message}\n`)
}

export function fail(message: string): void {
  process.stderr.write(`${pc.red('error')} ${message}\n`)
}

/**
 * Advice the reader should not miss, without the `warning` prefix: nothing has
 * gone wrong, but what happens next is theirs to get right.
 */
export function advise(message: string): void {
  process.stderr.write(pc.yellow(`${message}\n`))
}

export interface EngineOptions {
  cwd: string
  baseUrl?: string
  timeoutMs?: number
  /** Audit in real Chromium instead of jsdom. Needs the playwright peer. */
  browser?: boolean
  /**
   * Skip the rules the browserless engine cannot decide rather than running
   * them and discarding the answer. No effect under `--browser`, which can
   * decide them.
   */
  fast?: boolean
  /**
   * Pages audited at once: worker threads for the browserless engine, open
   * tabs for the browser one. 1 turns both off.
   */
  concurrency?: number
  /** Build directory to serve the pages from, or undefined for crawled pages. */
  directory?: string
}

/**
 * Audit the pages with whichever engine was asked for.
 *
 * Returns undefined when the browser was asked for and is not usable, having
 * already said so: Playwright missing is a setup problem with a specific fix,
 * not a crash, and both commands turn it into exit 2.
 */
export async function runEngine(
  pages: readonly CollectedPage[],
  options: EngineOptions,
): Promise<PageAudit[] | undefined> {
  const runnerOptions = {
    // The audited project, so the browser runner resolves Playwright from
    // there rather than from wherever npx unpacked this package.
    cwd: options.cwd,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  }

  if (!options.browser) {
    const { runPooledAudit } = await import('../audit/runners/pool.ts')
    return runPooledAudit(pages, {
      ...runnerOptions,
      ...(options.fast ? { fast: true } : {}),
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    })
  }

  const { BrowserUnavailableError, runBrowserAudit } = await import(
    '../audit/runners/playwright.ts'
  )
  try {
    return await runBrowserAudit(options.directory, pages, {
      ...runnerOptions,
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    })
  } catch (cause) {
    if (cause instanceof BrowserUnavailableError) {
      fail(cause.message)
      return undefined
    }
    throw cause
  }
}

/**
 * Write a document to `output`, or to stdout when there is none. Parent
 * directories are created, since a report path in CI usually names one that is
 * not there yet.
 */
export async function emitDocument(
  body: string,
  output: string | undefined,
  cwd: string,
): Promise<void> {
  if (output === undefined) {
    process.stdout.write(body)
    return
  }
  const target = path.resolve(cwd, output)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, body, 'utf8')
}
