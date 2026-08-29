import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectPages } from '../../../src/audit/collect.ts'
import { BrowserUnavailableError, runBrowserAudit } from '../../../src/audit/runners/playwright.ts'

/**
 * What the reader gets when the browser cannot be started at all.
 *
 * Setup problems and crashes want opposite things from whoever is looking at
 * them: one is a step left to run, the other is a bug to report. Playwright
 * hands both over as the same thrown Error, so the difference has to be made
 * here — and getting it wrong is what turned a missing browser download into a
 * stack trace through this package's bundled internals.
 */

const PAGE =
  '<!doctype html><html lang="en"><head><title>P</title></head><body><h1>P</h1></body></html>'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** A project with one page to audit and a Playwright that fails to launch. */
async function projectWhereLaunchThrows(message: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-launch-'))
  dirs.push(dir)
  await writeFile(path.join(dir, 'package.json'), '{"name":"fixture"}')
  await writeFile(path.join(dir, 'index.html'), PAGE, 'utf8')

  const module = path.join(dir, 'node_modules', 'playwright')
  await mkdir(module, { recursive: true })
  await writeFile(
    path.join(module, 'package.json'),
    JSON.stringify({ name: 'playwright', version: '1.99.0', main: 'index.cjs' }),
  )
  await writeFile(
    path.join(module, 'index.cjs'),
    'module.exports = { chromium: { launch: async () => { ' +
      `throw new Error(${JSON.stringify(message)}) } } }\n`,
  )
  return dir
}

async function audit(dir: string): Promise<unknown> {
  const pages = await collectPages(dir)
  return await runBrowserAudit(dir, pages, { cwd: dir })
}

/** Playwright's own wording, box and all, for a browser never downloaded. */
const NOT_DOWNLOADED = [
  "browserType.launch: Executable doesn't exist at /home/x/.cache/ms-playwright/chromium-1234/chrome",
  '╔════════════════════════════════════════════════════════════╗',
  '║ Looks like Playwright was just installed or updated.       ║',
  '║ Please run the following command to download new browsers: ║',
  '║     npx playwright install                                 ║',
  '╚════════════════════════════════════════════════════════════╝',
].join('\n')

describe('a browser that was never downloaded', () => {
  it('is reported as setup rather than thrown as a crash', async () => {
    // `npm i -D playwright` does not fetch Chromium, so somebody who followed
    // the install line exactly still lands here. It is the most common of the
    // setup failures and was the only one arriving as a stack trace.
    const dir = await projectWhereLaunchThrows(NOT_DOWNLOADED)

    await expect(audit(dir)).rejects.toBeInstanceOf(BrowserUnavailableError)
  })

  it('names the command that fixes it', async () => {
    const dir = await projectWhereLaunchThrows(NOT_DOWNLOADED)

    await expect(audit(dir)).rejects.toThrow(/npx playwright install chromium/)
  })

  it('names where the browser was looked for', async () => {
    // A wrong PLAYWRIGHT_BROWSERS_PATH looks exactly like a missing download
    // until you can see the path it went to, which containers get wrong often
    // enough to be worth the line.
    const dir = await projectWhereLaunchThrows(NOT_DOWNLOADED)

    // Caught rather than matched on: the raw Playwright message carries this
    // path too, so asserting the text alone would pass without any of the
    // rewriting this file exists to check.
    const error = await audit(dir).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(BrowserUnavailableError)
    expect((error as Error).message).toMatch(/ms-playwright\/chromium-1234\/chrome/)
  })

  it('drops the ASCII box Playwright wraps its advice in', async () => {
    const dir = await projectWhereLaunchThrows(NOT_DOWNLOADED)

    await expect(audit(dir)).rejects.not.toThrow(/╔/)
  })
})

describe('a launch that fails for any other reason', () => {
  it('is passed through untouched, because it is a real fault', async () => {
    // Dressing an arbitrary launch failure up as setup advice would send
    // somebody off installing a browser they already have.
    const dir = await projectWhereLaunchThrows('Target page, context or browser has been closed')

    await expect(audit(dir)).rejects.toThrow(/has been closed/)
  })

  it('is not relabelled as a setup problem', async () => {
    const dir = await projectWhereLaunchThrows('Target page, context or browser has been closed')

    await expect(audit(dir)).rejects.not.toBeInstanceOf(BrowserUnavailableError)
  })
})
