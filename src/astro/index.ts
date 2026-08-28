import { fileURLToPath } from 'node:url'
import type { ImpactLevel } from '../audit/impact.ts'
import type { OutputFormat } from '../cli/audit.ts'

/**
 * An Astro integration that audits the build Astro just produced.
 *
 * `astro build` already knows where the output went and when it finished, which
 * is the one moment a build-time auditor wants. Wiring the CLI into a project's
 * scripts works, but it means remembering to, and it means the audit runs in a
 * separate step that is easy to drop from a pipeline when it goes red.
 *
 * The Astro types are described structurally here rather than imported. Astro is
 * an optional peer dependency, exactly like Playwright, and a published .d.ts
 * that referenced `astro` would fail to typecheck for everyone who installed
 * this package without it. The shapes below are checked against the real
 * `AstroIntegration` type at compile time in the tests, and the integration is
 * driven by an actual `astro build` there, so the structural copy cannot drift
 * from the API it stands in for.
 */

/** The part of Astro's integration logger this uses. */
export interface AstroLoggerLike {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface BuildDoneOptions {
  /** Where Astro wrote the build. */
  dir: URL
  logger: AstroLoggerLike
}

export interface AstroIntegrationLike {
  name: string
  hooks: {
    'astro:build:done'?: (options: BuildDoneOptions) => void | Promise<void>
  }
}

export interface EaaKitIntegrationOptions {
  /** Lowest impact that fails the build. Defaults to 'serious'. */
  failOn?: ImpactLevel
  /**
   * Whether a failing audit fails the build. Defaults to true.
   *
   * The CLI has no equivalent because a shell can ignore an exit code; a build
   * hook cannot. Turning this off is for the first week of adopting the tool on
   * an existing site — after that, a baseline is the honest way to go green,
   * because it records what is wrong instead of hiding it.
   */
  failBuild?: boolean
  /** Skip the audit entirely. For turning it off by environment. */
  enabled?: boolean
  include?: string[]
  exclude?: string[]
  /** Audit pages under their real site URL instead of file://. */
  baseUrl?: string
  /** Audit in real Chromium. Needs the playwright peer. */
  browser?: boolean
  /** Worker threads for the browserless engine. */
  concurrency?: number
  /** Accept the violations recorded in this file; fail only on new ones. */
  baseline?: string
  /** Write a report as well as printing one. */
  format?: OutputFormat
  /** Where to write it. Required for `format` to do anything useful. */
  output?: string
}

export class AstroAuditError extends Error {
  override readonly name = 'AstroAuditError'
}

/**
 * Audit the build in `astro:build:done`, and fail the build if it does not pass.
 *
 * Failing by default is the point: an auditor that only ever prints is one
 * nobody reads. `failBuild: false` is there for the week it takes to adopt it,
 * and `baseline` is the answer after that.
 */
export default function eaaKit(options: EaaKitIntegrationOptions = {}): AstroIntegrationLike {
  return {
    name: 'eaa-kit',
    hooks: {
      'astro:build:done': async ({ dir, logger }: BuildDoneOptions) => {
        if (options.enabled === false) {
          logger.info('skipped (enabled: false)')
          return
        }

        // Imported here, not at the top: this module is loaded while Astro
        // reads its config, and pulling jsdom and axe-core in at that point
        // would add most of a second to every `astro dev` start too.
        const { runAuditCommand } = await import('../cli/audit.ts')

        const { exitCode } = await runAuditCommand(fileURLToPath(dir), {
          ...(options.failOn ? { failOn: options.failOn } : {}),
          ...(options.include ? { include: options.include } : {}),
          ...(options.exclude ? { exclude: options.exclude } : {}),
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
          ...(options.browser ? { browser: true } : {}),
          ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
          ...(options.baseline ? { baseline: options.baseline } : {}),
          ...(options.format ? { format: options.format } : {}),
          ...(options.output ? { output: options.output } : {}),
        })

        if (exitCode === 0) {
          logger.info('no violations at or above the threshold')
          return
        }

        // Exit 2 is not a failing audit, it is a run that reached no verdict —
        // a missing build directory, a page nothing could read, a baseline that
        // is not there. Passing that off as "violations found" would send
        // somebody looking for defects that were never measured.
        const message =
          exitCode === 2
            ? 'the audit could not be completed, so this build was not checked'
            : 'accessibility violations at or above the threshold'

        if (options.failBuild === false) {
          logger.warn(`${message} (failBuild: false, so the build continues)`)
          return
        }

        logger.error(message)
        throw new AstroAuditError(`eaa-kit: ${message}`)
      },
    },
  }
}
