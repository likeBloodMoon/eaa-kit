import path from 'node:path'
import {
  auditBuild,
  BuildAuditError,
  type IntegrationOptions,
  stderrLogger,
} from '../integration/run.ts'

/**
 * An Eleventy plugin that audits the site Eleventy just wrote.
 *
 *   // eleventy.config.js
 *   import eaaKit from 'eaa-kit/eleventy'
 *
 *   export default function (eleventyConfig) {
 *     eleventyConfig.addPlugin(eaaKit)
 *   }
 *
 * `eleventy.after` is the one moment a build-time auditor wants: the files are
 * written and the run has not ended. It also hands over the output directory,
 * which matters here more than for most builders — Eleventy's is configurable
 * and the audit would otherwise have to guess at `_site`.
 *
 * Eleventy's types are described structurally rather than imported, on the same
 * reasoning as the Astro integration and the Vite plugin: it is not a dependency
 * of this package, and a published .d.ts referring to one would fail to
 * typecheck for everyone who installed eaa-kit without it.
 */

export { BuildAuditError }

/** What `eleventy.after` is given. Only two of its fields are read. */
export interface EleventyAfterEvent {
  dir: { input: string; output: string }
  /** `build`, `watch` or `serve`. Only a one-shot build is audited. */
  runMode?: string
  /** `fs`, `json`, `ndjson` or `text`. Only `fs` writes files to audit. */
  outputMode?: string
}

/** The part of Eleventy's config object this plugin touches. */
export interface EleventyConfigLike {
  on(event: 'eleventy.after', handler: (event: EleventyAfterEvent) => Promise<void>): void
}

export type EaaKitEleventyOptions = IntegrationOptions

/**
 * Usable both as a bare plugin and as a configured one.
 *
 * `addPlugin(eaaKit)` and `addPlugin(eaaKit, { failOn: 'moderate' })` are both
 * how Eleventy plugins are written, and a plugin that only supported the second
 * would be the one people got wrong.
 */
export default function eaaKit(
  eleventyConfig: EleventyConfigLike,
  options: EaaKitEleventyOptions = {},
): void {
  eleventyConfig.on('eleventy.after', async (event: EleventyAfterEvent) => {
    // The same reasoning as the webpack plugin: `eleventy.after` fires on every
    // rebuild under --watch and --serve, and auditing a whole site on each save
    // would make a dev server unusable. A failing audit there cannot stop
    // anything being shipped either.
    if (event.runMode !== undefined && event.runMode !== 'build') return

    // `--to=json` and the other non-filesystem output modes write nothing to
    // disk, so there is no build directory to look at.
    if (event.outputMode !== undefined && event.outputMode !== 'fs') return

    await auditBuild(path.resolve(event.dir.output), options, stderrLogger())
  })
}
