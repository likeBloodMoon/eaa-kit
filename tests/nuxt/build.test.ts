import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * The module driven by a real `nuxt generate` and a real `nuxt build`.
 *
 * Everything this module does rests on claims about somebody else's lifecycle:
 * that `close` fires after Nitro has prerendered, that the output directory is
 * on the Nitro instance and not on `nuxt.options.nitro`, and that a server
 * build can be told from a static one. Hand-written stand-ins cannot check any
 * of them — they agree with whatever the author assumed, which is how the first
 * version of this module came to read `nuxt.options.nitro.output.publicDir`, a
 * value that is undefined in every build.
 *
 * Slow, and the only honest way to hold those claims.
 */

const REPO = path.join(import.meta.dirname, '../..')

const ENTRY = path.join(REPO, 'dist/nuxt/index.js')

const projects: string[] = []

const run = promisify(execFile)

/** Build once, if the bundle is not already there. As in the Astro suite. */
beforeAll(async () => {
  try {
    await access(ENTRY)
    return
  } catch {
    // not built yet
  }
  const require = createRequire(import.meta.url)
  const manifest = require('tsdown/package.json') as { bin: { tsdown: string } }
  const entry = path.join(path.dirname(require.resolve('tsdown/package.json')), manifest.bin.tsdown)
  await run(process.execPath, [entry], { cwd: REPO })
}, 180_000)

afterEach(async () => {
  await Promise.all(projects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const CLEAN = '<main><h1>Sauber</h1><p>Nichts zu melden.</p></main>'

// The link points at a route that exists: Nitro's prerender crawler follows
// links, and a 404 would fail the build before this module was reached — for a
// reason that has nothing to do with what these cases are about. An empty link
// is still an empty link.
const BROKEN = '<main><h1>Kaputt</h1><img src="/logo.png"><a href="/"></a></main>'

/** A minimal Nuxt project with this module wired into its config. */
async function project(page: string, moduleOptions = ''): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-nuxt-'))
  projects.push(dir)
  await mkdir(path.join(dir, 'app/pages'), { recursive: true })
  await mkdir(path.join(dir, 'public'), { recursive: true })

  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', type: 'module', private: true }),
    'utf8',
  )
  // A real file, or Vite fails to resolve the img in the template and the
  // build dies before this module is ever reached.
  await writeFile(path.join(dir, 'public/logo.png'), '\x89PNG\r\n\x1a\n', 'binary')
  await writeFile(path.join(dir, 'app/app.vue'), '<template><NuxtPage /></template>\n', 'utf8')
  await writeFile(path.join(dir, 'app/pages/index.vue'), `<template>${page}</template>\n`, 'utf8')
  await writeFile(
    path.join(dir, 'nuxt.config.ts'),
    `export default defineNuxtConfig({\n` +
      `  modules: [[${JSON.stringify(ENTRY)}, {${moduleOptions}}]],\n` +
      // node_modules is a link to the repo's, so without this Nuxt writes its
      // build next to the real one and the prerenderer cannot resolve
      // #internal/nuxt/paths out of a directory outside the project.
      `  buildDir: '.nuxt',\n` +
      // Nuxt emits neither a lang attribute nor a title, and both are serious
      // violations on every page it renders. Without them the "clean" fixture
      // is not clean and every case below would pass for the wrong reason —
      // which is itself a fair demonstration that the audit works.
      `  app: { head: { htmlAttrs: { lang: 'de' }, title: 'Fixture' } },\n` +
      `  devtools: { enabled: false },\n` +
      `  telemetry: false,\n` +
      `})\n`,
    'utf8',
  )
  await symlink(
    path.join(REPO, 'node_modules'),
    path.join(dir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  return dir
}

/** Run the real CLI, since that is what sets a build apart from a generate. */
async function nuxt(root: string, command: 'generate' | 'build'): Promise<string> {
  const bin = path.join(REPO, 'node_modules/nuxt/bin/nuxt.mjs')
  try {
    const { stdout, stderr } = await run(process.execPath, [bin, command], {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
    })
    return `${stdout}${stderr}`
  } catch (cause) {
    const failure = cause as { stdout?: string; stderr?: string; message?: string }
    return `FAILED ${failure.stdout ?? ''}${failure.stderr ?? ''}${failure.message ?? ''}`
  }
}

describe('nuxt generate', { timeout: 600_000 }, () => {
  it('audits the pages Nitro prerendered, which exist only by the close hook', async () => {
    // The claim the whole module rests on: Vite has finished long before this,
    // and at build:done the public directory does not exist at all.
    const output = await nuxt(await project(BROKEN), 'generate')

    expect(output).toContain('FAILED')
    expect(output).toContain('accessibility violations at or above the threshold')
  })

  it('lets a clean generate through', async () => {
    const output = await nuxt(await project(CLEAN), 'generate')

    expect(output).not.toContain('FAILED')
  })

  it('does not fail the build when told only to warn', async () => {
    const output = await nuxt(await project(BROKEN, 'failBuild: false'), 'generate')

    expect(output).not.toContain('FAILED')
  })
})

describe('nuxt build', { timeout: 600_000 }, () => {
  it('refuses to pass a server build rather than auditing a directory with no pages', async () => {
    // .output/public exists after `nuxt build` and holds assets with no page
    // among them. Auditing it would find nothing and report success.
    const output = await nuxt(await project(BROKEN), 'build')

    expect(output).toContain('FAILED')
    expect(output).toContain('this was a server build')
  })

  it('stands down where a server build is expected', async () => {
    const output = await nuxt(await project(BROKEN, 'allowServerBuild: true'), 'build')

    expect(output).not.toContain('FAILED')
  })
})
