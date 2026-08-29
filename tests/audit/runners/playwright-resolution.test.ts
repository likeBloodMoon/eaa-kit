import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BrowserUnavailableError,
  launcherIn,
  loadChromium,
} from '../../../src/audit/runners/playwright.ts'

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
    JSON.stringify({ name, version: '1.99.0', main: 'index.cjs' }),
  )

  // CommonJS, because Playwright is, and this whole function is about what
  // `await import()` does to a CommonJS module. An ESM stand-in with a default
  // export would exercise a shape that never occurs here.
  //
  // These live under node_modules, which is load-bearing: vitest externalises
  // anything there and lets Node load it, so the two shapes below really do
  // behave differently. Anywhere else vitest transforms the file and
  // synthesises named exports for both, and the distinction disappears.
  const launcher = `const chromium = { launch: async () => ({ marker: ${JSON.stringify(name)} }) }`
  const body = {
    // Assigned by shorthand, which is the form Node's lexer can follow, so
    // `chromium` hoists onto the namespace. Playwright on a good day.
    named: `${launcher}\nmodule.exports = { chromium }\n`,
    // The same module, assembled so the lexer cannot follow it. Nothing hoists,
    // everything lands on `default`, and reading only the named export reported
    // a working install as exporting no chromium launcher.
    'default-only': `${launcher}\nmodule.exports = Object.assign(Object.create(null), { chromium })\n`,
    'no-launcher': 'const devices = {}\nmodule.exports = { devices }\n',
  }[shape]
  await writeFile(path.join(module, 'index.cjs'), body)
  return dir
}

/** The namespace `await import()` gives for a project's stand-in module. */
async function namespaceOf(dir: string): Promise<Record<string, unknown>> {
  return await import(pathToFileURL(path.join(dir, 'node_modules', 'playwright', 'index.cjs')).href)
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

  it('builds two fixtures that really do load differently', async () => {
    // The pair is the point. If both shapes hoisted, or neither did, the two
    // tests below would exercise one code path while appearing to cover two —
    // so this asserts the difference they depend on actually exists here.
    //
    // Membership rather than the whole key list: what a CommonJS namespace
    // carries besides `default` is Node's business and has grown between
    // releases, and `module.exports` shows up as one on newer builds.
    expect(Object.keys(await namespaceOf(await project('playwright')))).toContain('chromium')
    expect(
      Object.keys(await namespaceOf(await project('playwright', 'default-only'))),
    ).not.toContain('chromium')
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

/**
 * The shape question, asked directly rather than through an import.
 *
 * Going through `loadChromium` for this would prove nothing under vitest: it
 * hands CommonJS back through an interop proxy that answers `.chromium`
 * whether or not Node hoisted it, so a module with its launcher only on
 * `default` is indistinguishable from one without, and these tests pass with
 * the fallback deleted. The same shapes are driven through real Node, from a
 * real install, by scripts/test-packaged.mjs.
 */
describe('launcherIn', () => {
  const chromium = { launch: async () => 'launched' }

  it('takes the launcher off the namespace when it hoisted', () => {
    expect(launcherIn({ chromium })).toBe(chromium)
  })

  it('takes it off default when it did not', () => {
    // "Playwright is installed but exports no chromium launcher", reported
    // against a perfectly good install, was this branch missing.
    expect(launcherIn({ default: { chromium } })).toBe(chromium)
  })

  it('prefers the namespace, so a good install never reaches the fallback', () => {
    const other = { launch: async () => 'other' }

    expect(launcherIn({ chromium, default: { chromium: other } })).toBe(chromium)
  })

  it('finds nothing on a module that carries no launcher', () => {
    expect(launcherIn({ devices: {} })).toBeUndefined()
    expect(launcherIn({ default: { devices: {} } })).toBeUndefined()
  })

  it('rejects a chromium that cannot launch, rather than failing later', () => {
    // A half-installed package can leave the key in place without the method.
    expect(launcherIn({ chromium: {} })).toBeUndefined()
    expect(launcherIn({ chromium: { launch: 'not a function' } })).toBeUndefined()
  })

  it('survives the shapes an import can legitimately hand back', () => {
    expect(launcherIn(undefined)).toBeUndefined()
    expect(launcherIn(null)).toBeUndefined()
    expect(launcherIn({})).toBeUndefined()
    expect(launcherIn({ default: undefined })).toBeUndefined()
  })
})
