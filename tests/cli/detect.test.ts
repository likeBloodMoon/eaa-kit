import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runDetectCommand } from '../../src/cli/detect.ts'

const STACKS = fileURLToPath(new URL('../fixtures/stacks/', import.meta.url))
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function stack(name: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-detect-'))
  dirs.push(dir)
  await cp(path.join(STACKS, name), dir, { recursive: true })
  return dir
}

describe('eaa-kit detect', () => {
  it('says what it found, the evidence, and what an audit would do', async () => {
    const output = await runDetectCommand(await stack('next-server'), { color: false })

    expect(output).toBe(
      [
        'Framework        Next.js  (package.json depends on next)',
        'Package manager  npm  (no lockfile, so npm)',
        'Next.js pages    5 listed by the build  (not listed, rendered on request: /user/[id])',
        '',
        'An audit would run npm run build, start the site with npm run start, and crawl the pages its build lists.',
        '  → npx eaa-kit',
        '',
      ].join('\n'),
    )
  })

  it('names the sites in a monorepo, and how to look at one', async () => {
    const output = await runDetectCommand(await stack('monorepo-two'), { color: false })

    expect(output).toContain('Monorepo         apps/docs (VitePress), apps/shop (Next.js)')
    expect(output).toContain('→ cd apps/docs && npx eaa-kit detect')
  })

  it('sends a CMS to --url, since it is never started uninvited', async () => {
    const output = await runDetectCommand(await stack('wordpress'), { color: false })

    expect(output).toContain('An audit would do nothing on its own: WordPress renders on a server')
    expect(output).toContain('→ npx eaa-kit audit --url')
  })

  it('prints the same as JSON', async () => {
    const output = await runDetectCommand(await stack('astro'), { json: true })

    expect(JSON.parse(output)).toMatchObject({
      framework: { id: 'astro' },
      packageManager: { name: 'pnpm' },
      plan: 'build',
      directory: 'public-html',
    })
  })

  it('builds nothing and starts nothing', async () => {
    // The next-server fixture has a build script; detect must not run it.
    const dir = await stack('next-server')
    const { readdir } = await import('node:fs/promises')
    const before = await readdir(dir, { recursive: true })

    await runDetectCommand(dir, { json: true })

    expect(await readdir(dir, { recursive: true })).toEqual(before)
  })
})
