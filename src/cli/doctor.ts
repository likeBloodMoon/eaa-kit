import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import pc from 'picocolors'
import { exists } from '../fs.ts'

/**
 * `eaa-kit doctor`.
 *
 * Everything that has to be true for this tool to work here, checked in one
 * go and shown on one screen: the Node version, the package manager, the
 * config, what detection makes of the project, the CI file, the baseline and
 * the optional browser. Each problem ends with the command that fixes it.
 *
 * Only what stops an audit from running is a failure, and exits 2. A missing
 * config, CI file or baseline is advice: the audit runs without them.
 */

export type DoctorStatus = 'ok' | 'warn' | 'fail' | 'skip'

export interface DoctorCheck {
  label: string
  status: DoctorStatus
  detail: string
  /** The command that fixes it. */
  fix?: string
}

export interface DoctorResult {
  checks: DoctorCheck[]
  exitCode: number
}

/** What doctor asks of the machine rather than the project. Injectable for tests. */
export interface DoctorEnvironment {
  nodeVersion?: string
  /** Whether a command can be run at all. */
  onPath?: (command: string) => Promise<boolean>
  /** Whether browser mode could run: Playwright, and Chromium downloaded for it. */
  chromium?: (cwd: string) => Promise<Pick<DoctorCheck, 'status' | 'detail' | 'fix'>>
}

export async function runDoctor(
  cwd: string,
  environment: DoctorEnvironment = {},
): Promise<DoctorResult> {
  const nodeVersion = environment.nodeVersion ?? process.versions.node
  const onPath = environment.onPath ?? canRun
  const chromium = environment.chromium ?? chromiumCheck
  const checks: DoctorCheck[] = []

  const engines = (
    createRequire(import.meta.url)('eaa-kit/package.json') as { engines: { node: string } }
  ).engines.node
  checks.push(
    nodeSatisfies(nodeVersion, engines)
      ? { label: 'Node.js', status: 'ok', detail: nodeVersion }
      : {
          label: 'Node.js',
          status: 'fail',
          detail: `${nodeVersion} is not supported; this needs ${engines}`,
          fix: 'install Node.js 22 LTS or newer from https://nodejs.org',
        },
  )

  const { detectProject } = await import('../audit/detect.ts')
  const detection = await detectProject(cwd)
  const inner = detection.site ?? detection

  const manager = detection.packageManager
  if (manager !== undefined) {
    const found = await onPath(manager.name)
    checks.push(
      found
        ? {
            label: 'Package manager',
            status: 'ok',
            detail: `${manager.name} (${manager.evidence})`,
          }
        : {
            label: 'Package manager',
            status: inner.build === undefined && inner.serve === undefined ? 'warn' : 'fail',
            detail: `${manager.name} is what this project uses (${manager.evidence}), and it is not installed`,
            fix:
              manager.name === 'pnpm' || manager.name === 'yarn'
                ? 'corepack enable'
                : manager.name === 'bun'
                  ? 'npm i -g bun'
                  : manager.name === 'deno'
                    ? 'npm i -g deno'
                    : 'install Node.js, which includes npm',
          },
    )
  }

  checks.push(siteCheck(detection))
  checks.push(await configCheck(cwd))
  checks.push(await ciCheck(cwd))
  checks.push(await baselineCheck(cwd))
  checks.push({ label: 'Browser mode', ...(await chromium(cwd)) })

  return {
    checks,
    exitCode: checks.some((item) => item.status === 'fail') ? 2 : 0,
  }
}

function siteCheck(detection: import('../audit/detect.ts').ProjectDetection): DoctorCheck {
  const inner = detection.site ?? detection
  const label = 'Site'
  const name = inner.framework?.name
  switch (detection.plan) {
    case 'nothing':
      return {
        label,
        status: 'fail',
        detail: `nothing to audit: an audit would ${detection.summary}`,
        fix: inner.build ?? 'npx eaa-kit audit ./path/to/build',
      }
    case 'choose-site':
      return {
        label,
        status: 'warn',
        detail: `a monorepo with ${detection.workspace?.sites.length ?? 0} sites`,
        fix: `cd ${detection.workspace?.sites[0]?.dir ?? '<site>'} && npx eaa-kit doctor`,
      }
    case 'url':
      return {
        label,
        status: 'warn',
        detail: `${name} renders on a server; audit it running, with --url`,
        fix: 'npx eaa-kit audit --url http://localhost:8000',
      }
    default:
      return {
        label,
        status: inner.appShell ? 'warn' : 'ok',
        detail: `${name ?? 'HTML'}: an audit would ${detection.summary}`,
        ...(inner.appShell ? { fix: 'npx eaa-kit audit --browser' } : {}),
      }
  }
}

async function configCheck(cwd: string): Promise<DoctorCheck> {
  const { findConfigFile, loadConfig } = await import('../config/load.ts')
  const file = await findConfigFile(cwd)
  if (file === undefined) {
    return {
      label: 'Config',
      status: 'warn',
      detail: 'none: audits run on defaults, and statements cannot be written',
      fix: 'npx eaa-kit init',
    }
  }
  const shown = path.relative(cwd, file) || path.basename(file)
  try {
    await loadConfig({ cwd, path: file })
    return { label: 'Config', status: 'ok', detail: shown }
  } catch (cause) {
    const issues = (cause as { issues?: string[] }).issues ?? []
    return {
      label: 'Config',
      status: 'fail',
      detail: `${shown}: ${[(cause as Error).message, ...issues].join('; ')}`,
      fix: 'npx eaa-kit init --force',
    }
  }
}

/** Where the CI systems `init` knows about keep their pipelines. */
async function ciCheck(cwd: string): Promise<DoctorCheck> {
  const { findGitRoot } = await import('./setup.ts')
  const root = (await findGitRoot(cwd)) ?? cwd
  const { glob } = await import('tinyglobby')
  const { readFile } = await import('node:fs/promises')
  const candidates = [
    ...(await glob(['.github/workflows/*.{yml,yaml}'], { cwd: root, dot: true })).sort(),
    '.gitlab-ci.yml',
    'bitbucket-pipelines.yml',
  ]
  for (const file of candidates) {
    try {
      if ((await readFile(path.join(root, file), 'utf8')).includes('eaa-kit')) {
        return { label: 'CI', status: 'ok', detail: file }
      }
    } catch {
      // not there
    }
  }
  return {
    label: 'CI',
    status: 'warn',
    detail: 'no pipeline runs eaa-kit, so nothing stops a barrier being merged',
    fix: 'npx eaa-kit init',
  }
}

async function baselineCheck(cwd: string): Promise<DoctorCheck> {
  const { DEFAULT_BASELINE_FILE, readBaseline } = await import('../audit/baseline.ts')
  if (!(await exists(path.join(cwd, DEFAULT_BASELINE_FILE)))) {
    return {
      label: 'Baseline',
      status: 'warn',
      detail: 'none: CI fails on every barrier the site has today, not only new ones',
      fix: 'npx eaa-kit init',
    }
  }
  try {
    const baseline = await readBaseline(DEFAULT_BASELINE_FILE, cwd)
    const today = new Date().toISOString().slice(0, 10)
    const expired = baseline.entries.filter(
      (entry) => entry.expiresOn !== undefined && entry.expiresOn < today,
    ).length
    const count = `${baseline.entries.length} ${baseline.entries.length === 1 ? 'entry' : 'entries'}`
    if (expired > 0) {
      return {
        label: 'Baseline',
        status: 'warn',
        detail: `${DEFAULT_BASELINE_FILE}: ${expired} ${expired === 1 ? 'entry has' : 'entries have'} expired and no longer suppress anything`,
        fix: 'npx eaa-kit baseline',
      }
    }
    return { label: 'Baseline', status: 'ok', detail: `${DEFAULT_BASELINE_FILE}, ${count}` }
  } catch (cause) {
    return {
      label: 'Baseline',
      status: 'fail',
      detail: (cause as Error).message,
      fix: 'npx eaa-kit baseline',
    }
  }
}

async function chromiumCheck(cwd: string): Promise<Pick<DoctorCheck, 'status' | 'detail' | 'fix'>> {
  const { loadChromium } = await import('../audit/runners/playwright.ts')
  let launcher: { executablePath?: () => string }
  try {
    launcher = (await loadChromium(cwd)) as { executablePath?: () => string }
  } catch {
    return {
      status: 'skip',
      detail: 'optional, for --browser: Playwright is not installed',
      fix: 'npm i -D playwright && npx playwright install chromium',
    }
  }
  const executable = launcher.executablePath?.()
  if (executable !== undefined && !(await exists(executable))) {
    return {
      status: 'warn',
      detail: 'Playwright is installed, but the Chromium it drives is not',
      fix: 'npx playwright install chromium',
    }
  }
  return { status: 'ok', detail: 'Playwright and Chromium are installed, for --browser' }
}

/** Whether `command --version` runs. */
async function canRun(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], {
      stdio: 'ignore',
      // npm, pnpm and yarn are .cmd shims on Windows, which only a shell runs.
      shell: process.platform === 'win32',
    })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

/**
 * Whether a Node version satisfies an `engines` range of the forms this
 * package uses: `^x.y.z`, `>=x.y.z`, joined with `||`. Not a semver library,
 * because one range is all it has to read.
 */
export function nodeSatisfies(version: string, range: string): boolean {
  const parse = (value: string): number[] =>
    value
      .replace(/^v/, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  const compare = (a: number[], b: number[]): number => {
    for (let i = 0; i < 3; i++) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0)
      if (diff !== 0) return diff
    }
    return 0
  }
  const have = parse(version)
  return range.split('||').some((alternative) => {
    const clause = alternative.trim()
    if (clause.startsWith('^')) {
      const want = parse(clause.slice(1))
      return have[0] === want[0] && compare(have, want) >= 0
    }
    if (clause.startsWith('>=')) return compare(have, parse(clause.slice(2))) >= 0
    return compare(have, parse(clause)) === 0
  })
}

export function formatDoctor(result: DoctorResult, color = pc.isColorSupported): string {
  const colors = pc.createColors(color)
  const mark: Record<DoctorStatus, string> = {
    ok: colors.green('✓'),
    warn: colors.yellow('!'),
    fail: colors.red('✗'),
    skip: colors.dim('–'),
  }
  const lines = result.checks.flatMap((item) => [
    `${mark[item.status]} ${item.label.padEnd(16)} ${item.detail}`,
    ...(item.fix === undefined || item.status === 'ok'
      ? []
      : [`  ${' '.repeat(16)} ${colors.cyan('→')} ${colors.bold(item.fix)}`]),
  ])
  const failed = result.checks.filter((item) => item.status === 'fail').length
  lines.push(
    '',
    failed === 0
      ? 'Nothing stops an audit from running here.'
      : `${failed} ${failed === 1 ? 'problem stops' : 'problems stop'} an audit from running here.`,
  )
  return `${lines.join('\n')}\n`
}
