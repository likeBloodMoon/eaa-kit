import { createRequire } from 'node:module'

/**
 * The published package version, reported by `--version` and stamped into the
 * JSON report.
 *
 * Resolved by package self-reference rather than a relative path: tsdown
 * bundles every module into dist/cli/index.js, so a path that is correct
 * relative to a source file is wrong in the bundle, and the depth differs per
 * file. Self-reference works from both, and depends on the "./package.json"
 * entry in the exports map, which must stay.
 */
export const TOOL_VERSION: string = (
  createRequire(import.meta.url)('eaa-kit/package.json') as { version: string }
).version
