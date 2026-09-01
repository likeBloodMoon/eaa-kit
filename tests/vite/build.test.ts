import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * The plugin driven by a real `vite build`.
 *
 * The other file in this directory drives the hooks directly, which is fast and
 * covers every branch, but a stand-in cannot answer the questions that decide
 * whether this plugin works at all: does Vite call `configResolved` and
 * `closeBundle` on it, is `build.outDir` the value the plugin thinks it is, does
 * `enforce: 'post'` really put it after the plugins that emit pages, and does
 * throwing inside `closeBundle` fail the build rather than being swallowed.
 *
 * The Nuxt module in this release is what a wrong assumption of that kind looks
 * like: it read a field its host never populates, its hand-written stand-in
 * agreed with the bug, and the suite was green over a module that could never
 * have worked. Every integration here is now driven by its real host.
 */

const REPO = path.join(import.meta.dirname, '../..')

const ENTRY = path.join(REPO, 'dist/vite/index.js')

const projects: string[] = []

interface PluginLike {
  name: string
  apply?: string
  enforce?: string
}

let eaaKit: (options?: Record<string, unknown>) => PluginLike
let vite: {
  build(config: Record<string, unknown>): Promise<unknown>
  resolveConfig(
    config: Record<string, unknown>,
    command: 'build' | 'serve',
  ): Promise<{ plugins: readonly PluginLike[] }>
}

beforeAll(async () => {
  // A file: URL, not the path: a bare Windows absolute path is not a valid ESM
  // specifier. The same reason the Astro and Eleventy fixtures resolve this way.
  eaaKit = (await import(pathToFileURL(ENTRY).href)).default as typeof eaaKit
  vite = (await import('vite')) as unknown as typeof vite
})

afterEach(async () => {
  await Promise.all(projects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const CLEAN = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Sauber</title></head>
<body><main><h1>Sauber</h1><p>Nichts zu melden.</p></main></body></html>`

const BROKEN = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Kaputt</title></head>
<body><main><h1>Kaputt</h1><img src="/logo.png"></main></body></html>`

/**
 * A project Vite can build, whose second page is clean or not.
 *
 * The page under test goes in `public/`, which Vite copies verbatim, rather
 * than being the entry HTML: Vite resolves `<img src>` in an entry as an asset
 * and would fail the build on the missing file before the audit ever ran, which
 * is a different failure wearing the same clothes.
 */
async function project(page: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'eaa-kit-vite-'))
  projects.push(root)
  await mkdir(path.join(root, 'src'), { recursive: true })
  await mkdir(path.join(root, 'public'), { recursive: true })
  await writeFile(path.join(root, 'src/main.js'), 'export default 1\n', 'utf8')
  await writeFile(path.join(root, 'public/seite.html'), page, 'utf8')
  await writeFile(
    path.join(root, 'index.html'),
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Start</title></head>
<body><main><h1>Start</h1></main><script type="module" src="/src/main.js"></script></body></html>`,
    'utf8',
  )
  return root
}

/** One build, resolving with the error Vite rejected with, or null. */
async function build(
  root: string,
  options: Record<string, unknown>,
  extra: { outDir?: string; plugins?: unknown[] } = {},
): Promise<Error | null> {
  try {
    await vite.build({
      root,
      logLevel: 'silent',
      build: { outDir: extra.outDir ?? 'dist' },
      // eaa-kit first, so that anything in `extra.plugins` is declared after it
      // and only `enforce: 'post'` can put the audit last.
      plugins: [eaaKit(options), ...(extra.plugins ?? [])],
    })
    return null
  } catch (error) {
    return error as Error
  }
}

describe('vite build', { timeout: 180_000 }, () => {
  it('fails the build when the site Vite just wrote has violations', async () => {
    const error = await build(await project(BROKEN), { failOn: 'critical' })

    expect(error?.message).toContain('accessibility violations at or above the threshold')
  })

  it('lets a clean build through', async () => {
    expect(await build(await project(CLEAN), {})).toBeNull()
  })

  it('does not fail the build when told only to warn', async () => {
    expect(await build(await project(BROKEN), { failOn: 'critical', failBuild: false })).toBeNull()
  })

  it('resolves outDir against the Vite root, which is where Vite leaves it relative', async () => {
    // Vite hands over `build.outDir` unresolved — 'zielordner', not an absolute
    // path — so a plugin that used it as given would look at a directory
    // relative to the working directory and audit nothing. Verified against the
    // real resolved config, not assumed.
    const root = await project(BROKEN)

    const error = await build(root, { failOn: 'critical' }, { outDir: 'zielordner' })

    expect(error?.message).toContain('accessibility violations at or above the threshold')
  })

  it('audits pages a later plugin emitted, which is what enforce: post buys', async () => {
    // A plugin still writing files when this one runs would otherwise be
    // audited by its absence: a clean pass over a site whose broken pages had
    // not been written yet is the worst result available.
    const root = await project(CLEAN)
    const latecomer = {
      name: 'emits-late',
      async closeBundle() {
        await writeFile(path.join(root, 'dist/spaet.html'), BROKEN, 'utf8')
      },
    }

    const error = await build(root, { failOn: 'critical' }, { plugins: [latecomer] })

    expect(error?.message).toContain('accessibility violations at or above the threshold')
  })

  it('stays out of a dev server, which has written nothing to audit', async () => {
    // `apply: 'build'` is a claim about Vite honouring it, so it is checked
    // against Vite's own plugin resolution rather than by reading the object.
    const root = await project(BROKEN)
    const named = (plugins: readonly PluginLike[]) => plugins.map((plugin) => plugin.name)

    const serve = await vite.resolveConfig({ root, plugins: [eaaKit()] }, 'serve')
    const built = await vite.resolveConfig({ root, plugins: [eaaKit()] }, 'build')

    expect(named(serve.plugins)).not.toContain('eaa-kit')
    expect(named(built.plugins)).toContain('eaa-kit')
  })

  it('reports through Vite own logger, prefixed', async () => {
    // A build log has many authors, and a bare line about accessibility in the
    // middle of one says nothing about what produced it.
    const lines: string[] = []
    const customLogger = {
      info: (message: string) => void lines.push(message),
      warn: (message: string) => void lines.push(message),
      warnOnce: (message: string) => void lines.push(message),
      error: (message: string) => void lines.push(message),
      clearScreen: () => {},
      hasErrorLogged: () => false,
      hasWarned: false,
    }
    const root = await project(BROKEN)

    await vite.build({
      root,
      customLogger,
      build: { outDir: 'dist' },
      plugins: [eaaKit({ failOn: 'critical', failBuild: false })],
    })

    expect(lines.some((line) => line.startsWith('eaa-kit: '))).toBe(true)
  })
})
