import {
  auditBuild,
  BuildAuditError,
  type IntegrationOptions,
  stderrLogger,
} from '../integration/run.ts'

/**
 * A Docusaurus plugin that audits the site Docusaurus just built.
 *
 *   // docusaurus.config.js
 *   plugins: [['eaa-kit/docusaurus', { failOn: 'serious' }]]
 *
 * `postBuild` runs once the whole site is on disk and is given `outDir`, which
 * is the cleanest hook of any builder here: no guessing at the directory, and no
 * ambiguity about whether the files are finished.
 *
 * A documentation site is an unusually good case for this. Docs are where an
 * organisation's own accessibility claims usually live, they are generated from
 * Markdown by machinery nobody on the team wrote, and nobody opens every page.
 *
 * Docusaurus's types are described structurally rather than imported, for the
 * same reason as every other integration here: it is not a dependency of this
 * package.
 */

export { BuildAuditError }

/** What `postBuild` is given. Only `outDir` is read. */
export interface PostBuildProps {
  outDir: string
  siteDir?: string
}

export interface DocusaurusPluginLike {
  name: string
  postBuild(props: PostBuildProps): Promise<void>
}

/** The part of Docusaurus's plugin context this uses. */
export interface LoadContextLike {
  siteDir?: string
}

export type EaaKitDocusaurusOptions = IntegrationOptions

export default function eaaKit(
  _context: LoadContextLike,
  options: EaaKitDocusaurusOptions = {},
): DocusaurusPluginLike {
  return {
    name: 'eaa-kit',
    async postBuild({ outDir }: PostBuildProps) {
      await auditBuild(outDir, options, stderrLogger())
    },
  }
}
