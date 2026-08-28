import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  detectFramework,
  detectPackageManager,
  findBuildOutput,
  readPackageJson,
} from '../../src/audit/project.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-project-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.join(dir, path.dirname(name)), { recursive: true })
    await writeFile(path.join(dir, name), body)
  }
  return dir
}

describe('findBuildOutput', () => {
  it.each(['dist', 'out', 'build', '_site', '.output/public'])(
    'finds %s when it holds HTML',
    async (name) => {
      const dir = await project({ [`${name}/index.html`]: '<html></html>' })

      expect(await findBuildOutput(dir)).toBe(path.join(dir, name))
    },
  )

  it('ignores a directory that exists but holds no HTML', async () => {
    // .next exists after any Next.js build and holds no browsable page; public/
    // exists in most projects and holds assets. Existing is not the test.
    const dir = await project({ '.next/build-manifest.json': '{}', 'public/logo.svg': '<svg/>' })

    expect(await findBuildOutput(dir)).toBeUndefined()
  })

  it('finds HTML nested inside the directory', async () => {
    const dir = await project({ 'dist/blog/post/index.html': '<html></html>' })

    expect(await findBuildOutput(dir)).toBe(path.join(dir, 'dist'))
  })

  it('prefers the earlier candidate when two would match', async () => {
    // Deterministic, so two runs of the same project audit the same directory.
    const dir = await project({ 'dist/a.html': '<html>', 'out/b.html': '<html>' })

    expect(await findBuildOutput(dir)).toBe(path.join(dir, 'dist'))
  })

  it('returns nothing for a project with no build', async () => {
    expect(await findBuildOutput(await project({ 'package.json': '{}' }))).toBeUndefined()
  })
})

describe('detectPackageManager', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
  ])('reads %s as %s', async (lockfile, expected) => {
    expect(await detectPackageManager(await project({ [lockfile]: '' }))).toBe(expected)
  })

  it('falls back to npm', async () => {
    // Running the wrong one either fails or silently installs a second
    // dependency tree, so this is decided by the lockfile, never guessed.
    expect(await detectPackageManager(await project({ 'package.json': '{}' }))).toBe('npm')
  })
})

describe('detectFramework', () => {
  it.each(['next', 'nuxt', 'astro', '@sveltejs/kit'])('recognises %s', async (name) => {
    const dir = await project({
      'package.json': JSON.stringify({ dependencies: { [name]: '1.0.0' } }),
    })

    expect(await detectFramework(dir)).toBe(name)
  })

  it('looks in devDependencies too', async () => {
    const dir = await project({
      'package.json': JSON.stringify({ devDependencies: { astro: '5.0.0' } }),
    })

    expect(await detectFramework(dir)).toBe('astro')
  })

  it('returns nothing for a project it does not recognise', async () => {
    expect(await detectFramework(await project({ 'package.json': '{}' }))).toBeUndefined()
  })
})

describe('readPackageJson', () => {
  it('reads the scripts', async () => {
    const dir = await project({ 'package.json': JSON.stringify({ scripts: { build: 'vite' } }) })

    expect((await readPackageJson(dir))?.scripts?.['build']).toBe('vite')
  })

  it.each([
    ['no package.json', {}],
    ['a package.json that is not JSON', { 'package.json': 'not json' }],
  ])('returns nothing for %s', async (_name, files) => {
    expect(await readPackageJson(await project(files))).toBeUndefined()
  })
})
