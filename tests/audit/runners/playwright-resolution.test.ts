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

/** A project carrying a stand-in for `name`, exporting in the given shape. */
async function project(
  name?: 'playwright' | '@playwright/test',
  shape: 'named' | 'default-only' | 'no-launcher' = 'named',
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-pw-'))
  dirs.push(dir)
  await writeFile(path.join(dir, 'package.json'), '{"name":"fixture"}')
  if (name === undefined) return dir

  const module = path.join(dir, 'node_modules', ...name.split('/'))
  await mkdir(module, { recursive: true })
  await writeFile(
    path.join(module, 'package.json'),
    JSON.stringify({ name, version: '1.99.0', type: 'module', main: 'index.js' }),
  )
  const launcher = `{ launch: async () => ({ marker: ${JSON.stringify(name)} }) }`
  const body = {
    named: `export const chromium = ${launcher}\n`,
    // Playwright is CommonJS, and whether `await import()` exposes its named
    // exports depends on Node's static analysis succeeding. When it does not,
    // everything is on `default` — which is the shape that broke in the field.
    'default-only': `export default { chromium: ${launcher} }\n`,
    'no-launcher': 'export const devices = {}\n',
  }[shape]
  await writeFile(path.join(module, 'index.js'), body)
  return dir
}

describe('loadChromium', () => {
  it('resolves Playwright from the audited project', async () => {
    // A bare import('playwright') resolves against this module's own location.
    // Run through npx that is a cache directory with no playwright in it, while
    // the project being audited has one — so somebody who had just installed it
    // was told to install it.
    const chromium = await loadChromium(await project('playwright'))

    expect(await chromium.launch()).toEqual({ marker: 'playwright' })
  })

  it('reads the launcher off default when the named export is not hoisted', async () => {
    // Reported from a real install as "installed but exports no chromium
    // launcher". Playwright is CommonJS and Node's named-export hoisting is not
    // guaranteed; when it fails everything sits on `default`.
    const chromium = await loadChromium(await project('playwright', 'default-only'))

    expect(await chromium.launch()).toEqual({ marker: 'playwright' })
  })

  it('accepts @playwright/test, which is what most projects install', async () => {
    const chromium = await loadChromium(await project('@playwright/test'))

    expect(await chromium.launch()).toEqual({ marker: '@playwright/test' })
  })

  it("falls back to this package's own resolution when the project has none", async () => {
    // Not an error here: this repo carries playwright as a devDependency, so
    // the fallback finds it. Only both failing is a setup problem.
    await expect(loadChromium(await project())).resolves.toBeDefined()
  })

  it('keeps looking when what the project has carries no launcher', async () => {
    // A half-installed or mismatched playwright in the project should not stop
    // the run when there is a working one further out.
    const chromium = await loadChromium(await project('playwright', 'no-launcher'))

    expect(chromium.launch).toBeTypeOf('function')
  })

  it('reports a missing Playwright as a setup problem, not a crash', () => {
    const error = new BrowserUnavailableError('x')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('BrowserUnavailableError')
  })
})
