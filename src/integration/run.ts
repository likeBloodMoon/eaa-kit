import type { ImpactLevel } from '../audit/impact.ts'
import type { OutputFormat } from '../cli/audit.ts'

/**
 * What a build-time integration does once the build has written its files.
 *
 * Astro, Vite and Next all reach the same point by different routes: a
 * directory exists, and the build should stop if what is in it fails the
 * threshold. Only the hook name and the logger differ, so only those live in
 * the integrations.
 */

export interface IntegrationOptions {
  /** Lowest impact that fails the build. Defaults to 'serious'. */
  failOn?: ImpactLevel
  include?: string[]
  exclude?: string[]
  baseUrl?: string
  /** Audit in real Chromium. Needs the playwright peer. */
  browser?: boolean
  concurrency?: number
  baseline?: string
  format?: OutputFormat
  /** Write the report here instead of the build log. */
  output?: string
  /**
   * Report without failing the build. For the week it takes to adopt this on a
   * site that already exists — a baseline is the honest way to go green after
   * that.
   */
  failBuild?: boolean
  /** Skip entirely. For turning it off per environment without unwiring it. */
  enabled?: boolean
}

/** The three methods every one of these build tools offers under some name. */
export interface IntegrationLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/**
 * Where an integration writes when its host offers no logger of its own.
 *
 * stderr rather than stdout, so a line about accessibility never lands in the
 * middle of a report being piped to a file, and prefixed either way: a message
 * in somebody's build log has to say what produced it.
 */
export function stderrLogger(): IntegrationLogger {
  const write = (message: string): void => {
    process.stderr.write(`eaa-kit: ${message}\n`)
  }
  return { info: write, warn: write, error: write }
}

/**
 * Thrown to fail the build. Its own class so a consumer can tell an audit
 * failure from the build tool falling over.
 */
export class BuildAuditError extends Error {
  override readonly name = 'BuildAuditError'
}

/**
 * Audit a finished build and decide whether it may proceed.
 *
 * Returns normally when the build should continue, and throws BuildAuditError
 * when it should not.
 */
export async function auditBuild(
  directory: string,
  options: IntegrationOptions,
  logger: IntegrationLogger,
): Promise<void> {
  // enabled and failBuild are this layer's own; everything else is what the
  // audit command already takes, and is handed over unchanged.
  const { enabled, failBuild, ...auditOptions } = options
  if (enabled === false) {
    logger.info('skipped (enabled: false)')
    return
  }

  // Imported here, not at the top: these modules are loaded while the build
  // tool reads its config, and pulling jsdom and axe-core in at that point
  // would charge most of a second to every dev-server start as well.
  const { runAuditCommand } = await import('../cli/audit.ts')

  const { exitCode } = await runAuditCommand(directory, auditOptions)

  if (exitCode === 0) {
    logger.info('no violations at or above the threshold')
    return
  }

  // Exit 2 is not a failing audit, it is a run that reached no verdict — a
  // missing build directory, a page nothing could read, a baseline that is not
  // there. Passing that off as "violations found" would send somebody looking
  // for defects that were never measured.
  const message =
    exitCode === 2
      ? 'the audit could not be completed, so this build was not checked'
      : 'accessibility violations at or above the threshold'

  if (failBuild === false) {
    logger.warn(`${message} (failBuild: false, so the build continues)`)
    return
  }

  logger.error(message)
  throw new BuildAuditError(`eaa-kit: ${message}`)
}
