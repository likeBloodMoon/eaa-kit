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
 * Nuxt builds on Vite, so `eaa-kit/vite` already runs in a Nuxt project. This
 * exists because it runs at the wrong moment and against the wrong directory,
 * and both were measured rather than assumed — a real `nuxt generate` drives
 * this in the tests, which is the only way to hold a claim about somebody
 * else's lifecycle honestly.
 *
 * **When.** Vite's `closeBundle` fires when Vite has finished, and Nitro
 * prerenders after that. At `build:done` the public directory does not exist
 * yet; at `close` it holds every prerendered page. So `close` it is.
 *
 * **Where.** The output directory is not on `nuxt.options.nitro.output` — that
 * is undefined throughout. Nitro resolves it onto its own instance, which
 * reaches a module through `nitro:init`, so the path is captured there and used
 * once the build is over.
 *
 * **What.** `nuxt build` produces a server: `.output/public` exists and holds
 * assets with no page among them. Auditing it would find nothing and report
 * success, which is the worst outcome available here, so a server build is told
 * what it is instead. `nitro.options.static` is what separates the two.
 */

export { BuildAuditError }

/** The part of the Nitro instance this reads, handed over by `nitro:init`. */
export interface NitroLike {
  options: {
    output?: { publicDir?: string }
    /** True for `nuxt generate`; absent for a server build. */
    static?: boolean
  }
}

export interface NuxtOptionsLike {
  rootDir?: string
}

export interface NuxtLike {
  options: NuxtOptionsLike
  hook(name: 'nitro:init', handler: (nitro: NitroLike) => void): void
  hook(name: 'close', handler: () => Promise<void>): void
}

export interface EaaKitNuxtOptions extends IntegrationOptions {
  /** Directory to audit. Defaults to the one Nitro says it wrote. */
  directory?: string
  /**
   * Let a server build pass without auditing anything.
   *
   * Off by default: `nuxt build` writes no browsable HTML, and a silent pass
   * over a directory with no pages in it is indistinguishable from a clean
   * site.
   */
  allowServerBuild?: boolean
}

export default function eaaKitModule(options: EaaKitNuxtOptions = {}, nuxt?: NuxtLike): void {
  // Nuxt calls a module with (options, nuxt). Guarding rather than asserting,
  // because a module invoked directly in a script would otherwise fail on a
  // property access rather than doing nothing.
  if (nuxt === undefined) return

  let publicDir: string | undefined
  let prerendered = false

  nuxt.hook('nitro:init', (nitro: NitroLike) => {
    publicDir = nitro.options.output?.publicDir
    prerendered = nitro.options.static === true
  })

  nuxt.hook('close', async () => {
    const directory = options.directory ?? publicDir

    // An explicit directory is somebody saying where the pages are, so it is
    // taken at face value; otherwise the build has to have prerendered some.
    if (options.directory === undefined && !prerendered) {
      if (options.allowServerBuild === true) return
      throw new BuildAuditError(
        'eaa-kit: this was a server build, so no pages were written to disk and there ' +
          'was nothing to audit. Run `nuxt generate` to prerender them, audit the ' +
          'running site with `eaa-kit audit --url`, or set allowServerBuild to skip this.',
      )
    }

    if (directory === undefined) {
      throw new BuildAuditError(
        'eaa-kit: Nitro reported no public directory, so there is no path to audit. ' +
          'Pass `directory` to the module to name one.',
      )
    }

    await auditBuild(
      path.resolve(nuxt.options.rootDir ?? process.cwd(), directory),
      options,
      stderrLogger(),
    )
  })
}
