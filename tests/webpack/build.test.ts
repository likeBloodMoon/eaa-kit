import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * The plugin driven by a real webpack compiler.
 *
 * Three of the things this plugin does are claims about webpack rather than
 * about this package: that `afterEmit` fires with every file on disk, that
 * `compilation.errors` says whether the build itself failed, and that
 * `compiler.watchMode` distinguishes a one-shot run from a dev server. The Nuxt
 * module shipped in 0.4.0 with a wrong claim of exactly that kind, agreed with
 * by its own stand-in, so these are checked against the real thing.
 *
 * webpack's Node API rather than its CLI: `run` and `watch` are the two entry
 * points that matter here and both are on it, so there is no reason to go
 * through a config file to reach them.
 */

const REPO = path.join(import.meta.dirname, '../..')

const ENTRY = path.join(REPO, 'dist/webpack/index.js')

const projects: string[] = []

type Plugin = new (options?: Record<string, unknown>) => { apply(compiler: unknown): void }

let EaaKitPlugin: Plugin
let webpack: (config: unknown) => {
  run(callback: (error: Error | null, stats?: unknown) => void): void
  watch(
    options: unknown,
    callback: (error: Error | null, stats?: unknown) => void,
  ): {
    close(callback: () => void): void
  }
  close(callback: () => void): void
  watchMode?: boolean
}

beforeAll(async () => {
  // A file: URL, not the path: a bare Windows absolute path is not a valid ESM
  // specifier. The same reason the Astro and Eleventy fixtures resolve this way.
  EaaKitPlugin = (await import(pathToFileURL(ENTRY).href)).default as Plugin
  webpack = ((await import('webpack')) as { default: typeof webpack }).default
})

afterEach(async () => {
  await Promise.all(projects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const CLEAN = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Sauber</title></head>
<body><main><h1>Sauber</h1><p>Nichts zu melden.</p></main></body></html>`

const BROKEN = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Kaputt</title></head>
<body><main><h1>Kaputt</h1><img src="/logo.png"></main></body></html>`

/**
 * A project webpack can build, with a page already in the output directory.
 *
 * The page is not something webpack emitted — it stands in for whatever put
 * HTML there, which in a real project is another plugin. What is under test is
 * that this plugin reads the directory webpack resolved, at a moment when the
 * files are on disk.
 */
async function project(page: string): Promise<{ root: string; output: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'eaa-kit-webpack-'))
  projects.push(root)
  await mkdir(path.join(root, 'src'), { recursive: true })
  await mkdir(path.join(root, 'out'), { recursive: true })
  await writeFile(path.join(root, 'src/index.js'), 'export default 1\n', 'utf8')
  await writeFile(path.join(root, 'out/index.html'), page, 'utf8')
  return { root, output: path.join(root, 'out') }
}

function config(root: string, output: string, options: Record<string, unknown>): unknown {
  return {
    mode: 'production',
    entry: path.join(root, 'src/index.js'),
    output: { path: output },
    plugins: [new EaaKitPlugin(options)],
  }
}

/** One compile, resolving with whatever webpack handed the callback. */
function run(configuration: unknown): Promise<{ error: Error | null }> {
  return new Promise((resolve) => {
    const compiler = webpack(configuration)
    compiler.run((error) => {
      compiler.close(() => resolve({ error }))
    })
  })
}

describe('webpack build', { timeout: 180_000 }, () => {
  it('fails the compile when the output directory has violations', async () => {
    const { root, output } = await project(BROKEN)

    const { error } = await run(config(root, output, { failOn: 'critical' }))

    expect(error?.message).toContain('accessibility violations at or above the threshold')
  })

  it('lets a clean build through', async () => {
    const { root, output } = await project(CLEAN)

    const { error } = await run(config(root, output, {}))

    expect(error).toBeNull()
  })

  it('does not fail the compile when told only to warn', async () => {
    const { root, output } = await project(BROKEN)

    const { error } = await run(config(root, output, { failOn: 'critical', failBuild: false }))

    expect(error).toBeNull()
  })

  it('audits the directory webpack resolved, not one of its own choosing', async () => {
    // `output.path` is where webpack actually wrote, and it is not `dist` here.
    // Guessing would look right on a default project and audit nothing on this.
    const { root, output } = await project(BROKEN)

    const { error } = await run(config(root, output, { failOn: 'critical' }))

    expect(error).not.toBeNull()
    expect(output.endsWith('out')).toBe(true)
  })

  it('leaves watch rebuilds alone, however bad the output', async () => {
    // The guard exists because this hook fires on every save. A dev server that
    // audited a whole site between keystrokes would be unusable, and a failure
    // there cannot stop anything being shipped.
    const { root, output } = await project(BROKEN)
    const compiler = webpack(config(root, output, { failOn: 'critical' }))

    // Sampled inside the callback: `close` puts watchMode back to false, so
    // reading it afterwards would say the guard had nothing to act on when it
    // did. This is the value the plugin sees when the hook fires.
    const { error, watchMode } = await new Promise<{
      error: Error | null
      watchMode: boolean | undefined
    }>((resolve) => {
      const watching = compiler.watch({}, (watchError) => {
        const seen = compiler.watchMode
        watching.close(() => resolve({ error: watchError, watchMode: seen }))
      })
    })

    expect(error).toBeNull()
    expect(watchMode).toBe(true)
  })
})
