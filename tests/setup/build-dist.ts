import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'

/**
 * Build the package once, before any suite runs.
 *
 * Three suites drive a real build of somebody else's tool — Astro, Eleventy,
 * Nuxt — and each has to load this package's built entry point, because a
 * consumer loads that and not the TypeScript source. CI runs `pnpm test` before
 * `pnpm smoke`, so `dist/` is not there yet and something has to make it.
 *
 * Each of them used to make it, with the same `beforeAll`. That was fine while
 * Astro was the only one and became a race as soon as it was not: vitest runs
 * test files in parallel workers, all three found `dist/` missing at once, and
 * all three spawned tsdown — which is configured with `clean: true` and so
 * deletes the directory the other two are in the middle of reading. It failed
 * in CI and not here, because a machine with `dist/` already built never
 * entered the race at all.
 *
 * `globalSetup` runs once, in the main process, before any worker starts. The
 * hazard is gone by construction rather than by timing.
 */

const REPO = path.join(import.meta.dirname, '../..')

export default async function build(): Promise<void> {
  // Not node_modules/.bin/tsdown: that shim is extensionless and unrunnable by
  // execFile on Windows, and its tsdown.CMD sibling needs shell: true there,
  // which Node refuses to spawn without (EINVAL). Resolving the package's own
  // entry and handing it to the running node is the same on all three
  // platforms.
  const require = createRequire(import.meta.url)
  const manifest = require('tsdown/package.json') as { bin: { tsdown: string } }
  const entry = path.join(path.dirname(require.resolve('tsdown/package.json')), manifest.bin.tsdown)
  await promisify(execFile)(process.execPath, [entry], { cwd: REPO })
}
