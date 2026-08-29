import path from 'node:path'
import {
  auditBuild,
  BuildAuditError,
  type IntegrationLogger,
  type IntegrationOptions,
} from '../integration/run.ts'

/**
 * eaa-kit as a Vite plugin.
 *
 * One plugin rather than four, because SvelteKit, Nuxt, Remix and Astro all
 * build on Vite: a plugin in the Vite config is a plugin in all of them. Only
 * Next.js needs its own, since it does not use Vite at all.
 *
 *   import eaaKit from 'eaa-kit/vite'
 *
 *   export default defineConfig({
 *     plugins: [eaaKit()],
 *   })
 *
 * The audit runs in `closeBundle`, after the build has written its files, and
 * fails the build on violations at or above the threshold. Failing by default
 * is the point: an auditor that only ever prints is one nobody reads.
 */

export { BuildAuditError }

export interface EaaKitPluginOptions extends IntegrationOptions {
  /**
   * Directory to audit, relative to the Vite root. Defaults to the build's own
   * `outDir`, which is the only place the plugin can know the files went.
   */
  directory?: string
}

/**
 * The parts of Vite this plugin touches, described structurally.
 *
 * So the published .d.ts does not reference vite, and installing eaa-kit in a
 * project that has none costs nothing and still typechecks. The same reasoning
 * as the Astro integration and the Playwright runner.
 */
export interface ResolvedConfigLike {
  root: string
  build: { outDir: string }
  logger?: {
    info(message: string): void
    warn(message: string): void
    error(message: string): void
  }
}

export interface VitePluginLike {
  name: string
  /** Build only: a dev server writes nothing to audit. */
  apply: 'build'
  /** Runs after the bundle is written, which is the earliest the files exist. */
  enforce?: 'post'
  configResolved(config: ResolvedConfigLike): void
  closeBundle(): Promise<void>
}

export default function eaaKit(options: EaaKitPluginOptions = {}): VitePluginLike {
  let directory: string | undefined
  let logger: IntegrationLogger | undefined

  return {
    name: 'eaa-kit',
    apply: 'build',
    // After every plugin that might still be writing files. A plugin that
    // emits pages later than this one would otherwise be audited by its
    // absence.
    enforce: 'post',

    configResolved(config: ResolvedConfigLike) {
      // outDir is relative to root unless it is already absolute, which is
      // exactly what path.resolve does with two arguments.
      directory = path.resolve(config.root, options.directory ?? config.build.outDir)
      logger = prefixed(config.logger)
    },

    async closeBundle() {
      if (directory === undefined || logger === undefined) {
        // configResolved always runs first in a real build; this is the case
        // where the plugin was called directly, and guessing a directory would
        // audit whatever happened to be in the working directory.
        throw new BuildAuditError('eaa-kit: the plugin was not given a resolved Vite config')
      }
      await auditBuild(directory, options, logger)
    },
  }
}

/**
 * Vite's own logger where there is one, the console otherwise.
 *
 * Prefixed either way: a line about accessibility in the middle of a build log
 * needs to say what produced it.
 */
function prefixed(logger: ResolvedConfigLike['logger']): IntegrationLogger {
  const write = (level: 'info' | 'warn' | 'error', message: string): void => {
    const line = `eaa-kit: ${message}`
    if (logger === undefined) process.stderr.write(`${line}\n`)
    else logger[level](line)
  }
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  }
}
