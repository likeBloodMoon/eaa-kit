import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { detectPackageManager, readPackageJson } from '../audit/project.ts'
import { TOOL_VERSION } from '../version.ts'

/**
 * The CI half of `eaa-kit init`: a GitHub Actions workflow written for this
 * project rather than copied from the docs and edited until it works.
 *
 * Everything in it is read from the project. The package manager comes from
 * the lockfile, the build from the `build` script, the directory from what
 * `init` found, and the baseline from whether one was just recorded. Anything
 * it cannot read is left to the action's own detection rather than guessed,
 * because a workflow that fails on its first push teaches somebody to switch
 * it off.
 */

/** Where the workflow goes, relative to the repository root. */
export const WORKFLOW_FILE = path.join('.github', 'workflows', 'accessibility.yml')

/** The repository this project is in, found the way git finds it: upwards. */
export async function findGitRoot(cwd: string): Promise<string | undefined> {
  let current = path.resolve(cwd)
  for (;;) {
    try {
      // A directory in a normal checkout, a file in a worktree or submodule.
      await stat(path.join(current, '.git'))
      return current
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return undefined
      current = parent
    }
  }
}

/** The branch HEAD points at, which is the one worth auditing on push. */
async function currentBranch(root: string): Promise<string | undefined> {
  try {
    const head = await readFile(path.join(root, '.git', 'HEAD'), 'utf8')
    return /^ref: refs\/heads\/(.+)$/m.exec(head)?.[1]?.trim()
  } catch {
    return undefined
  }
}

export interface WorkflowInputs {
  /** The project, which may be below the repository root in a monorepo. */
  cwd: string
  root: string
  /** The built site `init` found, absolute. Undefined leaves it to the action. */
  site?: string
  /** A baseline file relative to `cwd`, when there is one. */
  baseline?: string
  failOn: string
}

/**
 * The workflow, as text. YAML is written by hand rather than through a
 * library: it is one fixed shape with a few values in it, and the comments in
 * it are the documentation somebody reads when it first fails.
 */
export async function workflowFor(inputs: WorkflowInputs): Promise<string> {
  const pkg = await readPackageJson(inputs.cwd)
  const manager = pkg === undefined ? undefined : await detectPackageManager(inputs.cwd)
  const branch = (await currentBranch(inputs.root)) ?? 'main'
  const workingDirectory = toPosix(path.relative(inputs.root, inputs.cwd))
  const directory =
    inputs.site === undefined ? '' : toPosix(path.relative(inputs.cwd, inputs.site)) || '.'

  const setup: string[] = []
  if (manager === 'pnpm') {
    setup.push(
      '      - uses: pnpm/action-setup@v4',
      // action-setup reads the version from packageManager; without that field
      // it stops with "No pnpm version is specified".
      ...(typeof (pkg as { packageManager?: unknown } | undefined)?.packageManager === 'string'
        ? []
        : ['        with:', '          version: 10']),
    )
  }
  if (manager === 'bun') setup.push('      - uses: oven-sh/setup-bun@v2')

  const install =
    manager === undefined
      ? undefined
      : {
          npm: 'npm ci',
          pnpm: 'pnpm install --frozen-lockfile',
          yarn: 'yarn install --frozen-lockfile',
          bun: 'bun install --frozen-lockfile',
        }[manager]
  const build =
    manager !== undefined && pkg?.scripts?.['build'] !== undefined
      ? `${manager} run build`
      : undefined

  const withLines = [
    ...(workingDirectory === '' ? [] : [`working-directory: ${workingDirectory}`]),
    ...(install === undefined ? [] : [`install-command: ${install}`]),
    ...(build === undefined ? [] : [`build-command: ${build}`]),
    // Empty lets the action work the directory out, as `eaa-kit audit` does.
    `directory: ${directory === '' ? "''" : directory}`,
    `fail-on: ${inputs.failOn}`,
    ...(inputs.baseline === undefined ? [] : [`baseline: ${toPosix(inputs.baseline)}`]),
  ].map((line) => `          ${line}`)

  return [
    '# Written by eaa-kit init. Audits the built site against WCAG 2.2 AA on every',
    '# push and pull request, uploads what it finds to GitHub code scanning, and',
    '# fails the job on barriers at or above fail-on.',
    '#',
    '# The inputs are documented at',
    '# https://github.com/likeBloodMoon/eaa-kit/blob/master/docs/integrations.md#github-actions',
    'name: Accessibility',
    '',
    'on:',
    '  push:',
    `    branches: [${branch}]`,
    '  pull_request:',
    '',
    'permissions:',
    '  contents: read',
    '  # Required by the SARIF upload to code scanning.',
    '  security-events: write',
    '',
    'jobs:',
    '  audit:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    ...setup,
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 22',
    // The exact release that wrote this file. There is no moving tag to
    // follow, for the reason docs/integrations.md gives.
    `      - uses: likeBloodMoon/eaa-kit@v${TOOL_VERSION}`,
    '        with:',
    ...withLines,
    '',
  ].join('\n')
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}
