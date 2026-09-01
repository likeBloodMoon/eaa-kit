import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * The plugin driven by a real `eleventy` build.
 *
 * The shape of `eleventy.after` is an assumption about somebody else's
 * software, and the Nuxt module in this release is what a wrong one looks like:
 * it read a field that does not exist, its hand-written stand-in agreed, and
 * the suite was green over a module that could never have worked. Eleventy is
 * cheap to run, so there is no reason to leave it on trust.
 */

const REPO = path.join(import.meta.dirname, '../..')

const ENTRY = path.join(REPO, 'dist/eleventy/index.js')

const CLI = path.join(REPO, 'node_modules/@11ty/eleventy/cmd.cjs')

const projects: string[] = []

const run = promisify(execFile)

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

const CLEAN = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Sauber</title></head>
<body><main><h1>Sauber</h1><p>Nichts zu melden.</p></main></body></html>`

const BROKEN = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Kaputt</title></head>
<body><main><h1>Kaputt</h1><img src="/logo.png"></main></body></html>`

/** A minimal Eleventy project with this plugin added to its config. */
async function project(page: string, pluginOptions = '{}', output = '_site'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-11ty-'))
  projects.push(dir)
  await mkdir(path.join(dir, 'src'), { recursive: true })

  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', type: 'module', private: true }),
    'utf8',
  )
  await writeFile(path.join(dir, 'src/index.html'), page, 'utf8')
  await writeFile(
    path.join(dir, 'eleventy.config.mjs'),
    `import eaaKit from ${JSON.stringify(ENTRY)}\n` +
      `export default function (eleventyConfig) {\n` +
      `  eleventyConfig.addPlugin(eaaKit, ${pluginOptions})\n` +
      `  return { dir: { input: 'src', output: ${JSON.stringify(output)} } }\n` +
      `}\n`,
    'utf8',
  )
  await symlink(
    path.join(REPO, 'node_modules'),
    path.join(dir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )

  return dir
}

async function eleventy(root: string, args: string[] = []): Promise<string> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
    })
    return `${stdout}${stderr}`
  } catch (cause) {
    const failure = cause as { stdout?: string; stderr?: string; message?: string }
    return `FAILED ${failure.stdout ?? ''}${failure.stderr ?? ''}${failure.message ?? ''}`
  }
}

describe('eleventy build', { timeout: 180_000 }, () => {
  it('fails the build when the site Eleventy just wrote has violations', async () => {
    const output = await eleventy(await project(BROKEN))

    expect(output).toContain('FAILED')
    expect(output).toContain('accessibility violations at or above the threshold')
  })

  it('lets a clean build through', async () => {
    const output = await eleventy(await project(CLEAN))

    expect(output).not.toContain('FAILED')
  })

  it('does not fail the build when told only to warn', async () => {
    const output = await eleventy(await project(BROKEN, '{ failBuild: false }'))

    expect(output).not.toContain('FAILED')
  })

  it('audits the output directory the project configured, not a guess at _site', async () => {
    // Eleventy's output directory is configurable, and it hands the resolved
    // one over. Auditing `_site` regardless would look right on a default
    // project and silently audit nothing on this one.
    const output = await eleventy(await project(BROKEN, '{}', 'zielordner'))

    expect(output).toContain('FAILED')
    expect(output).toContain('accessibility violations at or above the threshold')
  })
})
