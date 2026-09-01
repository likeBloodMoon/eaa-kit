import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * The integration driven by a real `astro build`.
 *
 * The other file exercises the hook directly, which is fast and covers the
 * branches, but it cannot answer the two questions that actually decide whether
 * this integration works: does Astro call a hook by that name with those
 * options, and does throwing inside it fail the build? Both are assumptions
 * about somebody else's software, and the only way to hold them honestly is to
 * run it.
 *
 * Slower than the rest of the suite by a wide margin, and worth it: this is
 * what would notice an Astro major version changing the contract underneath us.
 */

const REPO = path.join(import.meta.dirname, '../..')

const ENTRY = path.join(REPO, 'dist/astro/index.js')

const projects: string[] = []

/**
 * Build once, if the bundle is not already there.
 *
 * This suite has to load the entry point a consumer would, and it cannot load
 * the source instead: Astro reads its config through a transform that strips
 * types rather than compiling them, and one `readonly` constructor parameter
 * elsewhere in this package is enough to stop it. Building is therefore part of
 * this test's setup rather than something it assumes somebody did first — the
 * CI order runs the suite before the build.
 */
afterEach(async () => {
  await Promise.all(projects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** A minimal Astro project with this integration wired into its config. */
async function project(page: string, integrationOptions = ''): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-astro-build-'))
  projects.push(dir)
  await mkdir(path.join(dir, 'src/pages'), { recursive: true })

  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', type: 'module', private: true }),
    'utf8',
  )
  await writeFile(path.join(dir, 'src/pages/index.astro'), `---\n---\n${page}\n`, 'utf8')
  // The built entry point, so this covers what a consumer actually imports.
  await writeFile(
    path.join(dir, 'astro.config.mjs'),
    `import { defineConfig } from 'astro/config'\n` +
      // A file: URL, not the path: a bare Windows absolute path
      // (D:\\a\\eaa-kit\\dist\\astro\\index.js) is not a valid ESM specifier, and
      // Vite fails to resolve it with an error of its own rather than one from
      // this integration.
      `import eaaKit from ${JSON.stringify(pathToFileURL(ENTRY).href)}\n` +
      `export default defineConfig({ integrations: [eaaKit({${integrationOptions}})] })\n`,
    'utf8',
  )
  // Astro and its plugins resolve from the project root. A junction rather than
  // a directory symlink on Windows: symlinks there need Developer Mode or an
  // elevated process, junctions need neither and behave the same for this.
  await symlink(
    path.join(REPO, 'node_modules'),
    path.join(dir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  return dir
}

async function astroBuild(root: string): Promise<{ failed: boolean; message: string }> {
  const { build } = await import('astro')
  try {
    await build({ root, logLevel: 'error' })
    return { failed: false, message: '' }
  } catch (cause) {
    return { failed: true, message: cause instanceof Error ? cause.message : String(cause) }
  }
}

const CLEAN = `<html lang="de"><head><meta charset="utf-8"><title>Sauber</title></head>
<body><main><h1>Sauber</h1><p>Nichts zu melden.</p></main></body></html>`

const BROKEN = `<html><head><title>Kaputt</title></head>
<body><img src="/logo.svg"><a href="/x/"></a></body></html>`

describe('astro build', { timeout: 180_000 }, () => {
  it('fails when the build Astro just produced has violations', async () => {
    const result = await astroBuild(await project(BROKEN))

    expect(result.failed).toBe(true)
    expect(result.message).toContain('accessibility violations at or above the threshold')
  })

  it('succeeds when the build is clean', async () => {
    const result = await astroBuild(await project(CLEAN))

    expect(result.failed).toBe(false)
  })

  it('does not fail the build when told only to warn', async () => {
    const result = await astroBuild(await project(BROKEN, 'failBuild: false'))

    expect(result.failed).toBe(false)
  })
})
