import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

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
beforeAll(async () => {
  try {
    await access(ENTRY)
    return
  } catch {
    // not built yet
  }
  // Not node_modules/.bin/tsdown: that shim is extensionless and unrunnable by
  // execFile on Windows, and its tsdown.CMD sibling needs shell: true there,
  // which Node refuses to spawn without (EINVAL) and which would put this path
  // through a shell on every platform. Resolving the package's own entry and
  // handing it to the running node is the same on all three.
  const require = createRequire(import.meta.url)
  const manifest = require('tsdown/package.json') as { bin: { tsdown: string } }
  const entry = path.join(path.dirname(require.resolve('tsdown/package.json')), manifest.bin.tsdown)
  await promisify(execFile)(process.execPath, [entry], { cwd: REPO })
}, 120_000)

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
      `import eaaKit from ${JSON.stringify(ENTRY)}\n` +
      `export default defineConfig({ integrations: [eaaKit({${integrationOptions}})] })\n`,
    'utf8',
  )
  // Astro and its plugins resolve from the project root.
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'), 'dir')

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
