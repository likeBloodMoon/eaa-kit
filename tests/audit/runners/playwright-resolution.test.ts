import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserUnavailableError, loadChromium } from '../../../src/audit/runners/playwright.ts'

/**
 * Where Playwright is resolved from, which is not where this module lives.
 *
 * Separate from playwright.test.ts, which skips wholesale without a real
 * Chromium. Resolution is exactly the part that broke in the field and exactly
 * the part that needs no browser to test.
 */

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** A project with a stand-in playwright, and nothing else. */
async function project(withPlaywright: boolean): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-pw-'))
  dirs.push(dir)
  await writeFile(path.join(dir, 'package.json'), '{"name":"fixture"}')
  if (!withPlaywright) return dir

  const module = path.join(dir, 'node_modules', 'playwright')
  await mkdir(module, { recursive: true })
  await writeFile(
    path.join(module, 'package.json'),
    '{"name":"playwright","version":"1.99.0","type":"module","main":"index.js"}',
  )
  await writeFile(
    path.join(module, 'index.js'),
    'export const chromium = { launch: async () => ({ marker: "from the project" }) }\n',
  )
  return dir
}

describe('loadChromium', () => {
  it('resolves Playwright from the audited project', async () => {
    // The bug this covers: a bare import('playwright') resolves against this
    // module's own location. Run through npx that is a cache directory with no
    // playwright in it, while the project being audited has one — so somebody
    // who had just installed it was told to install it.
    const chromium = await loadChromium(await project(true))

    expect(await chromium.launch()).toEqual({ marker: 'from the project' })
  })

  it("falls back to this package's own resolution when the project has none", async () => {
    // Not an error case here: this repo carries playwright as a devDependency,
    // so the fallback finds it. What matters is that a project without one does
    // not fail outright — the published package's own resolution is the second
    // place to look, and only both failing is a setup problem.
    await expect(loadChromium(await project(false))).resolves.toBeDefined()
  })

  it('reports a missing Playwright as a setup problem, not a crash', () => {
    const error = new BrowserUnavailableError('x')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BrowserUnavailableError')
  })
})
