import path from 'node:path'
import {
  auditBuild,
  BuildAuditError,
  type IntegrationOptions,
  stderrLogger,
} from '../integration/run.ts'

/**
 * A Nuxt module that audits what `nuxt generate` wrote.
 *
 *   // nuxt.config.ts
 *   export default defineNuxtConfig({
 *     modules: [['eaa-kit/nuxt', { failOn: 'serious' }]],
 *   })
 *
 * Nuxt builds on Vite, so `eaa-kit/vite` already works in a Nuxt project. This
 * exists for the two things that plugin cannot get right on its own.
 *
 * The first is *when*. Vite's `closeBundle` fires when Vite has finished, and in
 * Nuxt that is well before Nitro has prerendered anything: the pages the audit
 * exists to read are written after that, by a different part of the build. The
 * `close` hook is the end of the whole thing.
 *
 * The second is *what*. `nuxt build` produces a server, not browsable HTML;
 * only `nuxt generate` writes pages to `.output/public`. Auditing nothing and
 * reporting success would be the worst outcome available, so a run that
 * prerendered no pages says so rather than passing.
 *
 * Nuxt's types are described structurally rather than imported, for the same
 * reason as every other integration here.
 */

export { BuildAuditError }

/** The part of the resolved Nuxt options this reads. */
export interface NuxtOptionsLike {
  rootDir?: string
  /** Set when the build is a static generate rather than a server build. */
  _generate?: boolean
  nitro?: { output?: { publicDir?: string } }
}

export interface NuxtLike {
  options: NuxtOptionsLike
  hook(name: 'close', handler: () => Promise<void>): void
}

export interface EaaKitNuxtOptions extends IntegrationOptions {
  /** Directory to audit. Defaults to what Nitro says it wrote. */
  directory?: string
  /**
   * Audit even when the build produced no browsable HTML. Off by default: a
   * `nuxt build` writes a server, and silently passing an audit that read
   * nothing is worse than saying there was nothing to read.
   */
  allowServerBuild?: boolean
}

export default function eaaKitModule(options: EaaKitNuxtOptions = {}, nuxt?: NuxtLike): void {
  // Nuxt calls a module with (options, nuxt). Guarding rather than asserting,
  // because a module invoked directly in a test or a script would otherwise
  // fail with a property access on undefined.
  if (nuxt === undefined) return

  nuxt.hook('close', async () => {
    const publicDir = options.directory ?? nuxt.options.nitro?.output?.publicDir
    const root = nuxt.options.rootDir ?? process.cwd()

    if (publicDir === undefined) {
      if (options.allowServerBuild === true) return
      throw new BuildAuditError(
        'eaa-kit: this build wrote no public directory, so there was nothing to audit. ' +
          'Run `nuxt generate` to prerender pages, or audit the running site with ' +
          '`eaa-kit audit --url`.',
      )
    }

    await auditBuild(path.resolve(root, publicDir), options, stderrLogger())
  })
}
