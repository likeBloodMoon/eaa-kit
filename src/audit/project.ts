import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'tinyglobby'
import { exists, isDirectory } from '../fs.ts'
import { candidateOutputs } from './frameworks.ts'

/**
 * Working out what to audit when nobody said.
 *
 * `eaa-kit audit ./dist` assumes the reader knows which directory their builder
 * fills, that it has been built, and that it produces HTML at all — three
 * assumptions that are wrong often enough to be the main thing standing between
 * installing this tool and getting a report out of it. A Next.js project fails
 * all three at once.
 *
 * So with no directory and no --url, the tool works it out: an existing build
 * output if there is one, the project's own build if there is not, and the
 * project's server if the build produces nothing browsable. Naming a directory
 * or passing --url skips all of it.
 */

/** Ports the common dev and preview servers use, tried if nothing is announced. */
const KNOWN_PORTS = [3000, 4321, 5173, 8080, 4173, 3001]

/** How long to wait for a started server to answer. */
const SERVER_START_TIMEOUT_MS = 90_000

export interface PackageJson {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export async function readPackageJson(cwd: string): Promise<PackageJson | undefined> {
  try {
    return JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) as PackageJson
  } catch {
    return undefined
  }
}

/**
 * The package manager this project uses, from its lockfile.
 *
 * Running the wrong one either fails or, worse, silently installs a second
 * dependency tree, so the lockfile decides rather than a guess.
 */
export async function detectPackageManager(cwd: string): Promise<'pnpm' | 'yarn' | 'bun' | 'npm'> {
  const lockfiles = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
  ] as const
  for (const [file, manager] of lockfiles) {
    if (await exists(path.join(cwd, file))) return manager
  }
  return 'npm'
}

/**
 * The first build directory that exists and actually holds HTML.
 *
 * Existence alone is not enough: `.next/` exists after any Next.js build and
 * holds no browsable page, and `public/` exists in most projects and holds
 * assets. What makes a directory the build output is that there is HTML in it.
 */
export async function findBuildOutput(cwd: string): Promise<string | undefined> {
  // Framework-aware and ordered: `out/` before `dist/` in a Next.js project,
  // `_site/` in an Eleventy one, and whatever the config names before either.
  const candidates = await candidateOutputs(cwd, await readPackageJson(cwd))
  for (const candidate of candidates) {
    const directory = path.join(cwd, candidate)
    if (!(await isDirectory(directory))) continue
    const found = await glob(['**/*.html', '**/*.htm'], {
      cwd: directory,
      ignore: ['**/node_modules/**'],
      onlyFiles: true,
      dot: false,
    })
    if (found.length > 0) return directory
  }
  return undefined
}

/**
 * How to invoke a package-manager script on this platform.
 *
 * Not `shell: true` with an argument array: Node deprecated that in DEP0190
 * because the arguments are concatenated rather than escaped, and it prints a
 * warning into the middle of somebody's build output. Windows still needs a
 * shell — npm and pnpm are `.cmd` shims there, which cannot be spawned
 * directly — so cmd.exe is invoked explicitly with one command string instead.
 */
function scriptCommand(manager: string, script: string): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: manager, args: ['run', script] }
  return {
    command: process.env['ComSpec'] ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `${manager} run ${script}`],
  }
}

export interface ScriptRun {
  ok: boolean
  /** What was run, for the message when it fails. */
  command: string
}

/**
 * Run one of the project's own scripts and wait for it.
 *
 * stdio is inherited so the build's output goes where the user expects it. This
 * runs project code, which is what a build-time tool does — the Astro
 * integration already audits from inside one — but it is announced first and
 * `--no-build` turns it off.
 */
export async function runScript(cwd: string, script: string): Promise<ScriptRun> {
  const manager = await detectPackageManager(cwd)
  const command = `${manager} run ${script}`
  return new Promise((resolve) => {
    const { command: bin, args } = scriptCommand(manager, script)
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', () => resolve({ ok: false, command }))
    child.on('close', (code) => resolve({ ok: code === 0, command }))
  })
}

export interface RunningServer {
  origin: string
  stop: () => Promise<void>
}

/** Whether something is answering HTTP there yet. */
async function answers(origin: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    try {
      await fetch(origin, { signal: controller.signal })
      return true
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

/**
 * Start the project's server and wait until it answers.
 *
 * The origin is taken from whatever the server prints, since a project may be
 * on any port, and only falls back to probing the common ones. Returns undefined
 * if nothing came up before the timeout, having already stopped the process.
 */
export async function startServer(cwd: string, script: string): Promise<RunningServer | undefined> {
  const manager = await detectPackageManager(cwd)
  const { command: bin, args } = scriptCommand(manager, script)
  const child = spawn(bin, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so the whole tree can be signalled. `npm run start`
    // spawns the real server as a grandchild: signalling npm alone leaves that
    // grandchild running, and its pipes hold this process open after the report
    // has been written.
    detached: process.platform !== 'win32',
  })

  let announced: string | undefined
  const watch = (chunk: Buffer): void => {
    const match = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})/.exec(String(chunk))
    if (match && announced === undefined) announced = `http://localhost:${match[1]}`
  }
  child.stdout?.on('data', watch)
  child.stderr?.on('data', watch)

  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true

    // The group, not the process: see `detached` above.
    const signal = (name: NodeJS.Signals): void => {
      try {
        if (child.pid === undefined) return
        if (process.platform === 'win32') child.kill(name)
        else process.kill(-child.pid, name)
      } catch {
        // Already gone, which is the outcome wanted anyway.
      }
    }

    if (child.exitCode === null && child.signalCode === null) {
      signal('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          // A server that ignores SIGTERM would otherwise hold this open.
          signal('SIGKILL')
          resolve()
        }, 5000)
        child.once('close', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }

    // Even a dead child's pipes keep the event loop alive while they are open,
    // which is what made the process hang after the report was written.
    child.stdout?.destroy()
    child.stderr?.destroy()
    child.unref()
  }

  const deadline = Date.now() + SERVER_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return undefined
    for (const origin of announced === undefined
      ? KNOWN_PORTS.map((port) => `http://localhost:${port}`)
      : [announced]) {
      if (await answers(origin)) return { origin, stop }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  await stop()
  return undefined
}

/** What auditing with no arguments decided to do. */
export interface AutoSource {
  /** Build directory to audit, when the project produced browsable HTML. */
  directory?: string
  /** Site to crawl, when it did not. */
  url?: string
  /** Called when the audit is done, to stop anything this started. */
  cleanup?: () => Promise<void>
  /** What was done, for the reader. One line per step. */
  steps: string[]
}

export interface AutoDetectOptions {
  /** Never run the project's build or start its server. */
  noBuild?: boolean
  /** Announce each step as it is decided. */
  onStep?: (message: string) => void
}

/**
 * Work out what to audit in this project, building or serving it if need be.
 *
 * Returns undefined when there is nothing it can do, leaving the caller to
 * explain — it has better context for the message than this does.
 */
export async function autoDetectSource(
  cwd: string,
  options: AutoDetectOptions = {},
): Promise<AutoSource | undefined> {
  const steps: string[] = []
  const step = (message: string): void => {
    steps.push(message)
    options.onStep?.(message)
  }

  const existing = await findBuildOutput(cwd)
  if (existing !== undefined) {
    step(`Found a build in ${path.relative(cwd, existing) || '.'}/`)
    return { directory: existing, steps }
  }

  const pkg = await readPackageJson(cwd)
  if (pkg === undefined) return undefined

  const scripts = pkg.scripts ?? {}
  if (options.noBuild) return undefined

  // Nothing built yet. The project knows how to build itself, so ask it to,
  // rather than telling somebody to go and do it and come back.
  if (scripts['build'] !== undefined) {
    step('No build found; running the project build first')
    const built = await runScript(cwd, 'build')
    if (!built.ok) {
      step(`${built.command} failed`)
      return { steps }
    }
    const produced = await findBuildOutput(cwd)
    if (produced !== undefined) {
      step(`Built ${path.relative(cwd, produced) || '.'}/`)
      return { directory: produced, steps }
    }
  }

  // Built and still no HTML anywhere: the site renders on a server. Start it
  // and audit what it actually serves, which is the only honest view of it.
  const serveScript = ['start', 'preview', 'serve'].find((name) => scripts[name] !== undefined)
  if (serveScript === undefined) return { steps }

  step(`This site renders on a server; starting it with ${serveScript}`)
  const server = await startServer(cwd, serveScript)
  if (server === undefined) {
    step(`Could not start the site with ${serveScript}`)
    return { steps }
  }

  step(`Auditing ${server.origin}`)
  return { url: server.origin, cleanup: server.stop, steps }
}
