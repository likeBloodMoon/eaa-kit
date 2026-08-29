import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  candidateOutputs,
  detectFramework,
  FRAMEWORKS,
  outputFromConfig,
} from '../../src/audit/frameworks.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function project(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-fw-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.join(dir, path.dirname(name)), { recursive: true })
    await writeFile(path.join(dir, name), body)
  }
  return dir
}

const pkg = (deps: Record<string, string>, dev = true): Record<string, unknown> =>
  dev ? { devDependencies: deps } : { dependencies: deps }

describe('the registry itself', () => {
  it('gives every framework at least one output directory', () => {
    for (const framework of FRAMEWORKS) {
      expect(framework.outputs.length, framework.id).toBeGreaterThan(0)
    }
  })

  it('identifies every framework by a package or a file', () => {
    for (const framework of FRAMEWORKS) {
      expect(
        framework.packages.length > 0 || (framework.files?.length ?? 0) > 0,
        framework.id,
      ).toBe(true)
    }
  })

  it('pairs a config list with a pattern to read it, or has neither', () => {
    // One without the other is a config that is opened and never read, or a
    // pattern with nothing to run against.
    for (const framework of FRAMEWORKS) {
      expect(
        (framework.configs === undefined) === (framework.outputPattern === undefined),
        framework.id,
      ).toBe(true)
    }
  })

  it('uses ids that are unique', () => {
    const ids = FRAMEWORKS.map((framework) => framework.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('detectFramework', () => {
  it.each([
    ['next', 'Next.js', 'out'],
    ['nuxt', 'Nuxt', '.output/public'],
    ['@sveltejs/kit', 'SvelteKit', 'build'],
    ['astro', 'Astro', 'dist'],
    ['gatsby', 'Gatsby', 'public'],
    ['@docusaurus/core', 'Docusaurus', 'build'],
    ['vitepress', 'VitePress', '.vitepress/dist'],
    ['@11ty/eleventy', 'Eleventy', '_site'],
    ['@angular/core', 'Angular', 'dist'],
    ['react-scripts', 'Create React App', 'build'],
    ['@react-router/dev', 'React Router / Remix', 'build/client'],
    ['vite', 'Vite', 'dist'],
  ])('recognises %s as %s writing to %s', async (dependency, name, output) => {
    const cwd = await project({ 'package.json': '{}' })

    const detected = await detectFramework(cwd, pkg({ [dependency]: '1.0.0' }))

    expect(detected?.framework.name).toBe(name)
    expect(detected?.outputs[0]).toBe(output)
  })

  it.each([
    ['hugo.toml', 'Hugo'],
    ['_config.yml', 'Jekyll'],
  ])('recognises %s, which has no package.json to read', async (file, name) => {
    const detected = await detectFramework(await project({ [file]: '' }))

    expect(detected?.framework.name).toBe(name)
  })

  it('prefers the specific framework over the bundler underneath it', async () => {
    // A SvelteKit project depends on Vite. Calling it a Vite project would send
    // the reader to dist/, which SvelteKit does not use.
    const detected = await detectFramework(
      await project(),
      pkg({ '@sveltejs/kit': '2.0.0', vite: '6.0.0' }),
    )

    expect(detected?.framework.id).toBe('sveltekit')
  })

  it('reads dependencies as well as devDependencies', async () => {
    const detected = await detectFramework(await project(), pkg({ next: '16.0.0' }, false))

    expect(detected?.framework.id).toBe('next')
  })

  it('recognises nothing in a project it does not know', async () => {
    expect(await detectFramework(await project(), pkg({ express: '5.0.0' }))).toBeUndefined()
  })
})

describe('outputFromConfig', () => {
  const vite = FRAMEWORKS.find((framework) => framework.id === 'vite')!

  it.each([
    ["export default { build: { outDir: 'www' } }", 'www'],
    ['export default { build: { outDir: "public/site" } }', 'public/site'],
    ["export default { build: { outDir: './built' } }", 'built'],
  ])('reads %s', async (source, expected) => {
    const cwd = await project({ 'vite.config.ts': source })

    expect(await outputFromConfig(cwd, vite)).toBe(expected)
  })

  it('ignores an absolute path, which is somebody machine and not the project', async () => {
    const cwd = await project({
      'vite.config.ts': "export default { build: { outDir: '/tmp/x' } }",
    })

    expect(await outputFromConfig(cwd, vite)).toBeUndefined()
  })

  it('reads nothing from a config that computes the value', async () => {
    // A pattern that misses is a directory not found, which the caller already
    // handles. Executing the file to find out is a different class of risk.
    const cwd = await project({ 'vite.config.ts': 'export default { build: { outDir: dir } }' })

    expect(await outputFromConfig(cwd, vite)).toBeUndefined()
  })

  it('reads nothing when there is no config at all', async () => {
    expect(await outputFromConfig(await project(), vite)).toBeUndefined()
  })
})

describe('candidateOutputs', () => {
  it('puts the configured directory before the framework default', async () => {
    const cwd = await project({ 'vite.config.ts': "export default { build: { outDir: 'www' } }" })

    const candidates = await candidateOutputs(cwd, pkg({ vite: '6.0.0' }))

    expect(candidates[0]).toBe('www')
    expect(candidates).toContain('dist')
  })

  it("keeps the framework's own directories ahead of the generic ones", async () => {
    const candidates = await candidateOutputs(await project(), pkg({ next: '16.0.0' }))

    expect(candidates.indexOf('out')).toBeLessThan(candidates.indexOf('dist'))
  })

  it('falls back to the usual directories when nothing is recognised', async () => {
    const candidates = await candidateOutputs(await project(), pkg({ express: '5.0.0' }))

    expect(candidates).toEqual(['dist', 'out', 'build', '_site', 'public', '.output/public'])
  })

  it('lists no directory twice', async () => {
    const candidates = await candidateOutputs(await project(), pkg({ astro: '5.0.0' }))

    expect(new Set(candidates).size).toBe(candidates.length)
  })
})
