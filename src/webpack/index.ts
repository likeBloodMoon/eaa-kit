import path from 'node:path'
import {
  auditBuild,
  BuildAuditError,
  type IntegrationOptions,
  stderrLogger,
} from '../integration/run.ts'

/**
 * A webpack plugin that audits the output webpack just emitted.
 *
 *   // webpack.config.js
 *   const EaaKitPlugin = require('eaa-kit/webpack').default
 *
 *   module.exports = {
 *     plugins: [new EaaKitPlugin({ failOn: 'serious' })],
 *   }
 *
 * `afterEmit` is the first hook at which every file is on disk. `done` would
 * also work and fires later, but it runs for watch rebuilds too, and auditing a
 * whole site on every keystroke is not what anybody wants from a dev server —
 * so this audits production builds and leaves watch mode alone.
 *
 * Worth having even though webpack is not itself a site generator: it is what
 * Create React App, ejected setups, Angular's older builders and a long tail of
 * bespoke pipelines run, and none of them is covered by the Vite plugin.
 *
 * webpack's types are described structurally rather than imported, for the same
 * reason as every other integration here.
 */

export { BuildAuditError }

/** The part of a webpack compilation this reads. */
export interface CompilationLike {
  /** Non-empty when the build itself failed; there is nothing to audit then. */
  errors: readonly unknown[]
}

/** The part of the webpack compiler this plugin touches. */
export interface CompilerLike {
  options: { output?: { path?: string }; mode?: string }
  watchMode?: boolean
  hooks: {
    afterEmit: {
      tapPromise(name: string, handler: (compilation: CompilationLike) => Promise<void>): void
    }
  }
}

export interface EaaKitWebpackOptions extends IntegrationOptions {
  /** Directory to audit. Defaults to webpack's own `output.path`. */
  directory?: string
}

export default class EaaKitWebpackPlugin {
  constructor(private readonly options: EaaKitWebpackOptions = {}) {}

  apply(compiler: CompilerLike): void {
    compiler.hooks.afterEmit.tapPromise('eaa-kit', async (compilation: CompilationLike) => {
      // Watch rebuilds fire this on every save. Auditing a whole site each time
      // would make a dev server unusable, and a failing audit there cannot stop
      // anything being shipped anyway.
      if (compiler.watchMode === true) return

      // A build that failed has no output worth judging, and reporting missing
      // pages as accessibility findings would send somebody after defects that
      // were never measured.
      if (compilation.errors.length > 0) return

      const output = this.options.directory ?? compiler.options.output?.path
      if (output === undefined) {
        throw new BuildAuditError(
          'eaa-kit: webpack has no output.path, so there is no directory to audit. Set one, or pass `directory` to the plugin.',
        )
      }

      await auditBuild(path.resolve(output), this.options, stderrLogger())
    })
  }
}
