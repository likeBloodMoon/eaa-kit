import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pc from 'picocolors'
import type { CollectedPage } from '../audit/collect.ts'
import type { PageAudit } from '../audit/runners/jsdom.ts'
import type { AuditConfig } from '../config/define.ts'
import type { AuditCommandOptions } from './audit.ts'
import type { BaselineCommandOptions } from './baseline.ts'

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

/**
 * Audit defaults from the project's config file.
 *
 * `audit` and `baseline` are run from a build script over and over with the
 * same six flags, and the flags are the only place to say them: the config file
 * has existed since 0.2 and served the statement alone. An `audit` block there
 * is that list written once.
 *
 * Everything it returns is a default. The flags are merged over it by the
 * caller, because the file is the project's usual answer and a flag is somebody
 * asking for something else on this run.
 *
 * No config file at all is not an error, unlike for `statement`: this command
 * has always run against projects that have never heard of one. A file that
 * exists and cannot be read is exit 2 — it was written to be used, and running
 * on different settings than it names would be worse than stopping.
 */
export async function auditDefaults(
  options: {
    cwd?: string
    /** Explicit path, skipping the search. */
    config?: string
  } = {},
): Promise<AuditConfig> {
  // Imported here so that a run with no config file, and `--help`, never load
  // the module that reads one.
  const { loadAuditConfig } = await import('../config/load.ts')

  const loaded = await loadAuditConfig({
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.config ? { path: options.config } : {}),
  })

  if (!loaded?.audit) return {}
  note(`Defaults from ${path.basename(loaded.path)}`)
  return loaded.audit
}

/**
 * What the audit command was asked to do, from the config file and the flags.
 *
 * A function rather than four lines in the action, because the precedence is
 * the whole feature and the actions are the one part of this CLI a test cannot
 * call: commander owns them.
 */
export type AuditFlags = Omit<AuditCommandOptions, 'noBuild' | 'cwd' | 'timeoutMs'> & {
  /** commander's form of `--no-build`: true unless somebody typed the flag. */
  build?: boolean
  /** Where to read defaults from. Consumed before this point. */
  config?: string
}

export function auditInvocation(
  dir: string | undefined,
  defaults: AuditConfig,
  flags: AuditFlags,
): { dir: string | undefined; options: AuditCommandOptions } {
  const { build, config: _config, ...typed } = flags
  const { dir: configDir, build: configBuild, ...fromConfig } = defaults

  return {
    // The positional argument wins, and neither one given still means "work it
    // out from the project", as it always has.
    dir: dir ?? configDir,
    options: {
      ...fromConfig,
      ...typed,
      // `--no-build` reaches commander as build: true when nobody typed it, so
      // it cannot be merged like the rest. Either source asking for no build is
      // asking for no build.
      ...(build === false || configBuild === false ? { noBuild: true } : {}),
    },
  }
}

export type BaselineFlags = Omit<BaselineCommandOptions, 'cwd' | 'timeoutMs'> & { config?: string }

/**
 * The same, for `baseline`, which reads the defaults that mean the same thing
 * to it.
 *
 * Deliberately a subset. `output` names where the report goes for one command
 * and where the baseline goes for the other, so carrying it across would write
 * a baseline over the path somebody set aside for a report; `format`, `failOn`
 * and `baseline` all describe a verdict this command does not reach.
 */
export function baselineInvocation(
  dir: string | undefined,
  defaults: AuditConfig,
  flags: BaselineFlags,
): { dir: string; options: BaselineCommandOptions } {
  const { config: _config, ...typed } = flags

  return {
    // This command has no auto-detection, so something has to be named: the
    // argument, then the config file, then the directory most builds write to.
    dir: dir ?? defaults.dir ?? './dist',
    options: { ...baselineDefaults(defaults), ...typed },
  }
}

function baselineDefaults(config: AuditConfig) {
  return pick(config, [
    'include',
    'exclude',
    'baseUrl',
    'url',
    'allowRemote',
    'ignoreRobots',
    'sitemap',
    'maxPages',
    'maxDepth',
    'browser',
    'concurrency',
  ])
}

/** Copies the keys that are actually set, so nothing spreads an undefined over a real value. */
function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out: Partial<Pick<T, K>> = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out as Pick<T, K>
}
