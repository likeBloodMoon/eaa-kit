#!/usr/bin/env node
// Runs the packaged CLI the way somebody who installed it does. `pnpm test:packaged`.
//
// Three bugs reached users through this path and none of them could have been
// caught by the test suite, because the suite imports from src/ and runs inside
// this repo, where Playwright is a devDependency sitting right next to the code.
// Nothing about that arrangement resembles the one that broke:
//
//   - Playwright resolved against this package's own location instead of the
//     audited project's, so under npx — a cache directory with no playwright in
//     it — somebody who had just installed Playwright was told to install it.
//   - The launcher read off the named export only. Playwright is CommonJS and
//     Node's named-export hoisting is not guaranteed; when it fails everything
//     sits on `default`, and a working install was reported as exporting no
//     chromium launcher.
//   - A launch that threw left the loopback server holding the event loop open,
//     so a missing browser hung the run instead of reporting itself.
//
// What they have in common is topology: where the tool is versus where the
// project is. So this rebuilds that topology rather than describing it — the
// real tarball, extracted somewhere that is not the project, with Playwright
// installed only in the project.
//
// Dependencies are symlinked from this repo's own node_modules rather than
// installed from the registry. The point here is which directory a module
// resolves from, and a network install would add a minute and a flake for
// nothing.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = path.resolve(import.meta.dirname, '..')

/** Runtime dependencies, which the extracted tarball has none of. */
const DEPS = ['axe-core', 'commander', 'jsdom', 'picocolors', 'tinyglobby']

/**
 * A page with a contrast failure and nothing else wrong.
 *
 * Contrast is the assertion that matters: jsdom cannot evaluate it at all and
 * reports it unevaluated. If the browser engine silently did not run, this page
 * comes back clean — so finding the violation is what proves real Chromium was
 * driven, rather than the run quietly falling back to the browserless path.
 */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Scratch</title>
<style>body { background: #fff } .faint { color: #bbb; background: #fff }</style></head>
<body><main><h1>Scratch</h1><p class="faint">Low contrast text.</p></main></body></html>`

/** Long enough for a cold Chromium on a slow runner. */
const TIMEOUT_MS = 180_000

/**
 * What a run that cannot launch gets instead.
 *
 * A failing launch reports itself in about a second, so anything approaching
 * this is the hang rather than a slow machine — and the point of a regression
 * test for a hang is that it does not hang too.
 */
const FAILURE_TIMEOUT_MS = 20_000

let failures = 0

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${name}`)
  if (detail) console.log(detail.replace(/^/gm, '         '))
}

/** Symlink, as a junction on Windows, where a plain one needs privileges. */
async function link(target, linkPath) {
  await symlink(await realpath(target), linkPath, 'junction')
}

/**
 * The tool installed somewhere that is not the project.
 *
 * Extracted from a real `npm pack`, so the published file list is under test
 * too: a dist/ entry point left out of `files` fails here rather than on
 * somebody's machine.
 */
async function installTool(root) {
  const packed = spawnSync('npm', ['pack', '--pack-destination', root, '--silent'], {
    cwd: REPO,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (packed.error) throw new Error(`could not run npm: ${packed.error.message}`)
  if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr}`)

  const tarball = packed.stdout.trim().split('\n').pop().trim()
  const installed = path.join(root, 'tool', 'node_modules', 'eaa-kit')
  await mkdir(installed, { recursive: true })

  const extracted = spawnSync(
    'tar',
    ['-xzf', path.join(root, tarball), '-C', installed, '--strip-components=1'],
    { encoding: 'utf8' },
  )
  // tar ships with Windows 10 and up as well, so this needs no branch.
  if (extracted.error) throw new Error(`could not run tar: ${extracted.error.message}`)
  if (extracted.status !== 0) throw new Error(`tar failed: ${extracted.stderr}`)

  for (const dep of DEPS) {
    await link(path.join(REPO, 'node_modules', dep), path.join(root, 'tool', 'node_modules', dep))
  }
  return installed
}

/**
 * The audited project, carrying the Playwright the tool has to find.
 *
 * `playwright` is either the real one from this repo or a stand-in written
 * here, and nothing is linked at all when the case is about it being absent.
 */
async function makeProject(root, name, playwright) {
  const project = path.join(root, name)
  await mkdir(path.join(project, 'dist'), { recursive: true })
  await mkdir(path.join(project, 'node_modules'), { recursive: true })
  await writeFile(path.join(project, 'package.json'), '{"name":"scratch","private":true}\n')
  await writeFile(path.join(project, 'dist', 'index.html'), PAGE)

  if (playwright === 'real') {
    await link(
      path.join(REPO, 'node_modules', 'playwright'),
      path.join(project, 'node_modules', 'playwright'),
    )
  } else if (playwright !== undefined) {
    const module = path.join(project, 'node_modules', 'playwright')
    await mkdir(module, { recursive: true })
    await writeFile(
      path.join(module, 'package.json'),
      JSON.stringify({ name: 'playwright', version: '1.99.0', main: 'index.cjs' }),
    )
    await writeFile(path.join(module, 'index.cjs'), playwright)
  }
  return project
}

/** The CLI, run from the project exactly as an installed binary would be. */
function runCli(entry, project, args, timeout = TIMEOUT_MS) {
  const started = Date.now()
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: project,
    encoding: 'utf8',
    timeout,
    // Inherited so PLAYWRIGHT_BROWSERS_PATH keeps pointing wherever CI put it.
    env: process.env,
  })
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    elapsedMs: Date.now() - started,
    timedOut: result.error?.code === 'ETIMEDOUT',
  }
}

const root = await mkdtemp(path.join(tmpdir(), 'eaa-kit-packaged-'))

try {
  if (!existsSync(path.join(REPO, 'dist', 'cli', 'index.js'))) {
    throw new Error('dist is missing — run `pnpm build` first')
  }

  const installed = await installTool(root)
  const entry = path.join(installed, 'dist', 'cli', 'index.js')

  console.log('the published package')
  check('ships the CLI entry point named in bin', existsSync(entry))
  const manifest = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'))
  check(
    'ships every entry point named in exports',
    Object.values(manifest.exports)
      .flatMap((entry) => (typeof entry === 'string' ? [entry] : Object.values(entry)))
      .every((file) => existsSync(path.join(installed, file))),
  )

  // Existing on disk is not the same as loading. Every build-time integration
  // is a subpath export nothing else in the suite imports the published copy
  // of, and a broken one fails inside somebody's build rather than here —
  // which is exactly how the browser-mode bugs of 0.2.x reached users.
  // Every integration is loadable both ways. The hosts differ: a Nuxt or Astro
  // config is ESM, while webpack, Docusaurus and Eleventy configs are very often
  // CommonJS, and `require` of a subpath with no `require` condition fails
  // outright with ERR_PACKAGE_PATH_NOT_EXPORTED — which is what the documented
  // webpack usage did before this was checked. Node's require(esm) covers it on
  // every version in `engines`, but only for a module graph with no top-level
  // await; adding one later would break CommonJS consumers silently, so it is
  // asserted here rather than discovered in somebody's build.
  for (const subpath of ['astro', 'vite', 'eleventy', 'docusaurus', 'webpack', 'nuxt']) {
    const required = spawnSync(
      process.execPath,
      [
        '-e',
        `const m = require(${JSON.stringify(`eaa-kit/${subpath}`)})
         if (typeof m.default !== 'function') throw new Error('no default export')
         console.log('ok')`,
      ],
      { cwd: installed, encoding: 'utf8' },
    )
    check(
      `the ${subpath} entry loads from a CommonJS config`,
      required.status === 0,
      `${required.stdout}${required.stderr}`.trim(),
    )
  }

  for (const subpath of ['astro', 'vite', 'eleventy', 'docusaurus', 'webpack', 'nuxt']) {
    const file = path.join(installed, 'dist', subpath, 'index.js')
    const loaded = spawnSync(
      process.execPath,
      [
        '-e',
        `import(${JSON.stringify(pathToFileURL(file).href)})
           .then((m) => {
             if (typeof m.default !== 'function') throw new Error('no default export')
             console.log('ok')
           })
           .catch((error) => { console.error(String(error)); process.exit(1) })`,
      ],
      { encoding: 'utf8' },
    )
    check(
      `the ${subpath} entry loads from a real install`,
      loaded.status === 0,
      `${loaded.stdout}${loaded.stderr}`.trim(),
    )
  }

  // The whole point: the tool is under root/tool, the project under root/browser,
  // and Playwright is installed only in the latter. This is npx.
  console.log('\n--browser, from an install that is not the project')
  {
    const project = await makeProject(root, 'browser', 'real')
    const run = runCli(entry, project, ['audit', 'dist', '--browser'])

    check(
      'resolves Playwright out of the audited project',
      !/needs Playwright/.test(run.output),
      run.output,
    )
    check(
      'finds a chromium launcher on the real CommonJS module',
      !/no chromium launcher/.test(run.output),
      run.output,
    )
    check(
      'drove real Chromium, not the browserless fallback',
      /· chromium/.test(run.output),
      run.output,
    )
    // jsdom reports contrast as unevaluated, so this can only come from a browser.
    check(
      'reports the contrast failure only a browser can see',
      /color-contrast/.test(run.output),
      run.output,
    )
    check('exits 1 for a violation it found', run.status === 1, `exit ${run.status}`)
  }

  console.log('\na launch that fails')
  {
    // Throws from launch after resolving cleanly. The loopback server is already
    // listening by then, and leaving it open is what used to hang the run.
    const project = await makeProject(
      root,
      'throws',
      'module.exports = { chromium: { launch: async () => { throw new Error("launch refused") } } }\n',
    )
    const run = runCli(entry, project, ['audit', 'dist', '--browser'], FAILURE_TIMEOUT_MS)

    check('exits instead of hanging on the open server', !run.timedOut, `ran ${run.elapsedMs}ms`)
    check('exits non-zero', run.status !== 0, `exit ${run.status}`)
    check('says what actually went wrong', /launch refused/.test(run.output), run.output)
  }

  console.log('\na Playwright whose named exports do not hoist')
  {
    // Real CommonJS, assembled so the lexer cannot see through it — which is the
    // shape that reported a working install as exporting no launcher. Reaching a
    // launch attempt at all means the launcher was read off `default`.
    const project = await makeProject(
      root,
      'default-only',
      'const chromium = { launch: async () => { throw new Error("launch reached") } }\n' +
        'module.exports = Object.assign(Object.create(null), { chromium })\n',
    )
    const run = runCli(entry, project, ['audit', 'dist', '--browser'])

    check('reads the launcher off default', !/no chromium launcher/.test(run.output), run.output)
    check('got as far as launching', /launch reached/.test(run.output), run.output)
  }

  console.log('\nno Playwright at all')
  {
    const project = await makeProject(root, 'none', undefined)
    const run = runCli(entry, project, ['audit', 'dist', '--browser'])

    check('names the peer dependency to install', /needs Playwright/.test(run.output), run.output)
    check(
      'exits 2, because it could not run rather than found something',
      run.status === 2,
      `exit ${run.status}`,
    )
    check('does not print a stack trace at somebody', !/\bat \w+ \(/.test(run.output), run.output)
  }

  console.log('\nthe browserless path, which must not need any of this')
  {
    const project = await makeProject(root, 'jsdom', undefined)
    const run = runCli(entry, project, ['audit', 'dist'])

    check('audits without Playwright installed', run.status === 0 || run.status === 1, run.output)
    // The same page the browser called a violation. Unevaluated and passing are
    // the distinction this whole tool rests on, so it is worth asserting that
    // dropping the browser moves contrast to the first and not the second.
    //
    // Matched on words rather than on the bullet the report puts in front of
    // them: the console falls back to ASCII on Windows consoles that render
    // those glyphs as mojibake, so `·` becomes `-` on exactly the platform this
    // harness exists to cover.
    check(
      'leaves contrast unevaluated rather than passing it',
      /Not evaluated/.test(run.output) &&
        /color-contrast/.test(run.output) &&
        /No violations/.test(run.output),
      run.output,
    )
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('')
if (failures > 0) {
  console.error(`${failures} check${failures === 1 ? '' : 's'} failed`)
  process.exit(1)
}
console.log('packaged install ok')
