import { fileURLToPath } from 'node:url'
import { auditBuild, BuildAuditError, type IntegrationOptions } from '../integration/run.ts'

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

/**
 * The same options every build-time integration takes; see IntegrationOptions
 * for what each one does. Aliased rather than restated so the Astro and Vite
 * entries cannot drift apart.
 */
export type EaaKitIntegrationOptions = IntegrationOptions

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
        // The decision itself is shared with the Vite plugin: both arrive at a
        // finished build in a directory and have to decide whether it may
        // proceed. Only the hook name and the logger differ.
        try {
          await auditBuild(fileURLToPath(dir), options, logger)
        } catch (cause) {
          if (cause instanceof BuildAuditError) throw new AstroAuditError(cause.message)
          throw cause
        }
      },
    },
  }
}
