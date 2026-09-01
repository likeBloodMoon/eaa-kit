import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { collectPages } from '../../../src/audit/collect.ts'
import type { PageAudit } from '../../../src/audit/result.ts'
import { runJsdomAudit } from '../../../src/audit/runners/jsdom.ts'
import { runBrowserAudit } from '../../../src/audit/runners/playwright.ts'

/**
 * A page whose only real defect is invisible without CSS: the text is
 * #cccccc on white, which no amount of markup inspection can detect.
 */
const STYLES = ['body { background: #ffffff; }', '.faint { color: #cccccc; }'].join('\n')

const PAGE = [
  '<!doctype html>',
  '<html lang="de">',
  '  <head>',
  '    <title>Kontrast</title>',
  '    <link rel="stylesheet" href="/assets/site.css" />',
  '  </head>',
  '  <body>',
  '    <main>',
  '      <h1>Überschrift</h1>',
  '      <p class="faint">Dieser Text hat zu wenig Kontrast.</p>',
  '    </main>',
  '  </body>',
  '</html>',
].join('\n')

let directory: string
let browserAudit: PageAudit
let jsdomAudit: PageAudit

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'eaa-kit-browser-'))
  await mkdir(path.join(directory, 'assets'), { recursive: true })
  await writeFile(path.join(directory, 'assets', 'site.css'), STYLES, 'utf8')
  await writeFile(path.join(directory, 'index.html'), PAGE, 'utf8')

  const pages = await collectPages(directory)
  const [browser] = await runBrowserAudit(directory, pages)
  const [jsdom] = await runJsdomAudit(pages)
  if (!browser || !jsdom) throw new Error('expected one audit per engine')
  browserAudit = browser
  jsdomAudit = jsdom
}, 180_000)

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('what the browser can see that jsdom cannot', () => {
  it('finds the contrast violation jsdom could only shrug at', () => {
    expect(browserAudit.violations.map((finding) => finding.ruleId)).toContain('color-contrast')
    expect(jsdomAudit.violations.map((finding) => finding.ruleId)).not.toContain('color-contrast')
  })

  it('reaches a verdict on every rule, leaving nothing unevaluated', () => {
    const blind = browserAudit.incomplete.filter(
      (finding) => finding.reason === 'engine-limitation',
    )

    expect(blind).toEqual([])
  })

  it('is the engine jsdom points at for the rules it gives up on', () => {
    const unevaluated = jsdomAudit.incomplete
      .filter((finding) => finding.reason === 'engine-limitation')
      .map((finding) => finding.ruleId)

    expect(unevaluated).toContain('color-contrast')
    expect(unevaluated.length).toBeGreaterThan(0)
  })

  it('loads the stylesheet, which file:// URLs would not', () => {
    // The whole reason the runner serves the build over loopback. Without the
    // stylesheet the text is default black and the violation disappears.
    const contrast = browserAudit.violations.find((finding) => finding.ruleId === 'color-contrast')

    expect(contrast?.nodes[0]?.html).toContain('faint')
  })
})

describe('shared result shape', () => {
  it('labels the engine', () => {
    expect(browserAudit.engine).toBe('browser')
    expect(jsdomAudit.engine).toBe('jsdom')
  })

  it('reports the same logical URL as the browserless engine, not the loopback port', () => {
    expect(browserAudit.url).toBe(jsdomAudit.url)
    expect(browserAudit.url).not.toContain('127.0.0.1')
  })

  it('covers the same rules as jsdom, so the two reports compare', () => {
    const ruleIds = (audit: PageAudit) =>
      new Set([
        ...audit.violations.map((finding) => finding.ruleId),
        ...audit.incomplete.map((finding) => finding.ruleId),
        ...audit.passes.map((outcome) => outcome.ruleId),
        ...audit.inapplicable.map((outcome) => outcome.ruleId),
      ])

    expect(ruleIds(browserAudit)).toEqual(ruleIds(jsdomAudit))
  })

  it('files every rule in exactly one bucket', () => {
    const all = [
      ...browserAudit.violations.map((finding) => finding.ruleId),
      ...browserAudit.incomplete.map((finding) => finding.ruleId),
      ...browserAudit.passes.map((outcome) => outcome.ruleId),
      ...browserAudit.inapplicable.map((outcome) => outcome.ruleId),
    ]

    expect(all.length).toBe(new Set(all).size)
  })

  it('keeps standards references on findings', () => {
    const contrast = browserAudit.violations.find((finding) => finding.ruleId === 'color-contrast')

    expect(contrast?.successCriteria).toContain('1.4.3')
    expect(contrast?.enClauses).toContain('9.1.4.3')
    expect(contrast?.impact).toBe('serious')
  })
})

describe('runBrowserAudit', () => {
  it('returns nothing for no pages, without launching a browser', async () => {
    await expect(runBrowserAudit(directory, [])).resolves.toEqual([])
  })

  it('records a page it could not load rather than throwing', async () => {
    const missing = [
      { relativePath: 'gone.html', absolutePath: path.join(directory, 'gone.html'), html: '' },
    ]

    const [audit] = await runBrowserAudit(directory, missing)

    expect(audit?.error).toContain('404')
    expect(audit?.violations).toEqual([])
  }, 120_000)
})

describe('audit --browser, end to end', () => {
  /**
   * The headline invocation: no directory argument, so auto-detection finds the
   * build. It used to hand the browser runner no directory at all, which is the
   * runner's signal that these pages came off a running site and already have
   * somewhere to be fetched from — so it skipped the loopback server and
   * navigated Chromium to `/tmp/…/index.html`, a filesystem path and not a URL.
   * Every page errored, and the summary opened with "No violations".
   */
  it('audits the build it found rather than failing every page', async () => {
    const { runAuditCommand } = await import('../../../src/cli/audit.ts')
    const project = await mkdtemp(path.join(tmpdir(), 'eaa-kit-browser-cli-'))
    await writeFile(path.join(project, 'package.json'), '{"name":"site","private":true}', 'utf8')
    await mkdir(path.join(project, 'dist'), { recursive: true })
    await mkdir(path.join(project, 'dist', 'assets'), { recursive: true })
    await writeFile(path.join(project, 'dist', 'assets', 'site.css'), STYLES, 'utf8')
    await writeFile(path.join(project, 'dist', 'index.html'), PAGE, 'utf8')

    const writes = { stdout: process.stdout.write, stderr: process.stderr.write }
    process.stdout.write = (() => true) as typeof process.stdout.write
    process.stderr.write = (() => true) as typeof process.stderr.write
    try {
      const { audits } = await runAuditCommand(undefined, {
        cwd: project,
        browser: true,
        noBuild: true,
      })

      expect(audits).toHaveLength(1)
      expect(audits[0]?.error).toBeUndefined()
      // Served over loopback, so the stylesheet loaded and the rule that needs
      // it reached a verdict — the whole point of passing the directory along.
      expect(audits[0]?.violations.map((finding) => finding.ruleId)).toContain('color-contrast')
    } finally {
      process.stdout.write = writes.stdout
      process.stderr.write = writes.stderr
      await rm(project, { recursive: true, force: true })
    }
  }, 180_000)
})
