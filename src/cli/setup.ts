import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { detectPackageManager, readDenoConfig, readPackageJson } from '../audit/project.ts'
import { exists } from '../fs.ts'
import { TOOL_VERSION } from '../version.ts'
import type { CiHost } from './hosts.ts'

export { CI_HOST_NAMES, CI_HOSTS, type CiHost } from './hosts.ts'

/**
 * The CI half of `eaa-kit init`: a pipeline written for this project rather
 * than copied from the docs and edited until it works. GitHub Actions, GitLab
 * CI or Bitbucket Pipelines, whichever the repository is hosted on, since many
 * of the agencies this tool is for are not on GitHub.
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

/** GitLab reads one file; a project that already has one gets the job in a file it includes. */
export const GITLAB_FILE = '.gitlab-ci.yml'
export const GITLAB_INCLUDED_FILE = path.join('.gitlab', 'eaa-kit.gitlab-ci.yml')
export const BITBUCKET_FILE = 'bitbucket-pipelines.yml'

/**
 * Which CI the repository is on, from where it is pushed to.
 *
 * The remote decides first, because it is where the pipeline will run: a
 * GitHub mirror of a GitLab project still runs GitLab's pipeline. Then a
 * pipeline file already in the repository. GitHub is the answer when nothing
 * says otherwise, which is what `init` did before it knew any other host.
 * Self-hosted GitLab is recognised by a host name with "gitlab" in it, which is
 * the convention; anything else can be named with `--ci`.
 */
export async function detectCiHost(root: string): Promise<CiHost> {
  const remotes = await remoteUrls(root)
  for (const url of remotes) {
    const host = hostOf(url)
    if (host === undefined) continue
    if (host === 'github.com' || host.endsWith('.github.com')) return 'github'
    if (host === 'bitbucket.org' || host.includes('bitbucket')) return 'bitbucket'
    if (host.includes('gitlab')) return 'gitlab'
  }
  if (await exists(path.join(root, GITLAB_FILE))) return 'gitlab'
  if (await exists(path.join(root, BITBUCKET_FILE))) return 'bitbucket'
  return 'github'
}

/** Remote URLs from .git/config, origin first. */
async function remoteUrls(root: string): Promise<string[]> {
  let config: string
  try {
    config = await readFile(path.join(root, '.git', 'config'), 'utf8')
  } catch {
    return []
  }
  const urls: Array<{ name: string; url: string }> = []
  let remote: string | undefined
  for (const line of config.split(/\r?\n/)) {
    const section = /^\s*\[remote\s+"([^"]+)"\]/.exec(line)
    if (section) {
      remote = section[1]
      continue
    }
    if (/^\s*\[/.test(line)) {
      remote = undefined
      continue
    }
    const url = /^\s*url\s*=\s*(\S+)/.exec(line)?.[1]
    if (remote !== undefined && url !== undefined) urls.push({ name: remote, url })
  }
  urls.sort((a, b) => Number(b.name === 'origin') - Number(a.name === 'origin'))
  return urls.map((entry) => entry.url)
}

/** The host of `https://host/…`, `ssh://git@host/…` or scp-style `git@host:…`. */
function hostOf(url: string): string | undefined {
  const scp = /^[^@/]+@([^:/]+):/.exec(url)
  if (scp?.[1]) return scp[1].toLowerCase()
  try {
    return new URL(url).hostname.toLowerCase() || undefined
  } catch {
    return undefined
  }
}

/**
 * Where a pipeline for `host` would be written, or why none can be.
 *
 * Nothing is ever overwritten. GitHub has a directory of workflows, so a file
 * of its own is always possible unless one of that name exists. GitLab has one
 * file: without it, it is written; with it, the job goes in a file of its own
 * and the reader is told the two lines that include it. Bitbucket has one file
 * and no include, so a project that has one is pointed at the docs instead.
 */
export async function pipelinePlan(
  root: string,
  host: CiHost,
): Promise<{ file: string; include?: string } | { refused: string }> {
  const at = (file: string) => path.join(root, file)
  switch (host) {
    case 'github':
      return (await exists(at(WORKFLOW_FILE)))
        ? { refused: `${toPosix(WORKFLOW_FILE)} already exists` }
        : { file: WORKFLOW_FILE }
    case 'gitlab':
      if (!(await exists(at(GITLAB_FILE)))) return { file: GITLAB_FILE }
      if (await exists(at(GITLAB_INCLUDED_FILE))) {
        return { refused: `${toPosix(GITLAB_INCLUDED_FILE)} already exists` }
      }
      return { file: GITLAB_INCLUDED_FILE, include: toPosix(GITLAB_INCLUDED_FILE) }
    case 'bitbucket':
      return (await exists(at(BITBUCKET_FILE)))
        ? {
            refused: `${BITBUCKET_FILE} already exists, and Bitbucket has no way to include another file. Add the step from docs/integrations.md#bitbucket-pipelines`,
          }
        : { file: BITBUCKET_FILE }
  }
}

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

/** What every pipeline needs to know about the project, whichever host runs it. */
interface ProjectFacts {
  manager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'deno' | undefined
  /** Whether package.json names the pnpm version, which pnpm's GitHub action needs. */
  pinsPackageManager: boolean
  install: string | undefined
  build: string | undefined
  branch: string
  /** The project relative to the repository root, POSIX, '' at the root. */
  workingDirectory: string
  /** The built site relative to the project, POSIX, '' when it is left to detection. */
  directory: string
}

async function projectFacts(inputs: WorkflowInputs): Promise<ProjectFacts> {
  const pkg = await readPackageJson(inputs.cwd)
  const deno = await readDenoConfig(inputs.cwd)
  // A Deno project may have no package.json at all; anything else without one
  // is a site written by hand, with nothing to install or build.
  const manager =
    pkg !== undefined
      ? await detectPackageManager(inputs.cwd)
      : deno !== undefined
        ? 'deno'
        : undefined
  const install =
    manager === undefined
      ? undefined
      : {
          npm: 'npm ci',
          pnpm: 'pnpm install --frozen-lockfile',
          yarn: 'yarn install --frozen-lockfile',
          bun: 'bun install --frozen-lockfile',
          // None: `deno task` fetches what the build needs as it runs, and
          // `deno install` is not a dependency install on every Deno version.
          deno: undefined,
        }[manager]
  // Deno runs a package.json script as a task too; npm and the rest cannot run
  // a Deno task.
  const hasBuild =
    pkg?.scripts?.['build'] !== undefined ||
    (manager === 'deno' && deno?.tasks?.['build'] !== undefined)
  return {
    manager,
    pinsPackageManager:
      typeof (pkg as { packageManager?: unknown } | undefined)?.packageManager === 'string',
    install,
    build:
      manager !== undefined && hasBuild
        ? `${manager} ${manager === 'deno' ? 'task' : 'run'} build`
        : undefined,
    branch: (await currentBranch(inputs.root)) ?? 'main',
    workingDirectory: toPosix(path.relative(inputs.root, inputs.cwd)),
    directory:
      inputs.site === undefined ? '' : toPosix(path.relative(inputs.cwd, inputs.site)) || '.',
  }
}

/** The pipeline for `host`, as text. */
export async function pipelineFor(host: CiHost, inputs: WorkflowInputs): Promise<string> {
  const facts = await projectFacts(inputs)
  switch (host) {
    case 'github':
      return githubWorkflow(facts, inputs)
    case 'gitlab':
      return gitlabJob(facts, inputs)
    case 'bitbucket':
      return bitbucketPipeline(facts, inputs)
  }
}

/**
 * The workflow, as text. YAML is written by hand rather than through a
 * library: it is one fixed shape with a few values in it, and the comments in
 * it are the documentation somebody reads when it first fails.
 */
export async function workflowFor(inputs: WorkflowInputs): Promise<string> {
  return pipelineFor('github', inputs)
}

function githubWorkflow(facts: ProjectFacts, inputs: WorkflowInputs): string {
  const { manager, install, build, branch, workingDirectory, directory } = facts
  const setup: string[] = []
  if (manager === 'pnpm') {
    setup.push(
      '      - uses: pnpm/action-setup@v4',
      // action-setup reads the version from packageManager; without that field
      // it stops with "No pnpm version is specified".
      ...(facts.pinsPackageManager ? [] : ['        with:', '          version: 10']),
    )
  }
  if (manager === 'bun') setup.push('      - uses: oven-sh/setup-bun@v2')
  if (manager === 'deno') setup.push('      - uses: denoland/setup-deno@v2')

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
    '      - uses: actions/checkout@v6',
    ...setup,
    '      - uses: actions/setup-node@v6',
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

/**
 * The commands a job runs, for the hosts that have no eaa-kit action: set up
 * the package manager in a plain Node image, install, build, audit.
 *
 * The console report goes to the job log, which is where somebody reading a
 * failed job looks, and the Markdown summary is kept as an artifact. The
 * release is pinned for the reason the GitHub workflow pins it.
 */
function auditScript(facts: ProjectFacts, inputs: WorkflowInputs): string[] {
  const script: string[] = []
  if (facts.workingDirectory !== '') script.push(`cd ${quote(facts.workingDirectory)}`)
  if (facts.manager === 'pnpm' || facts.manager === 'yarn') script.push('corepack enable')
  // In the Node image, because the audit runs through npx: Bun from npm, where
  // it publishes itself, and Deno from its own installer.
  if (facts.manager === 'bun') script.push('npm install --global bun')
  if (facts.manager === 'deno') {
    script.push(
      'curl -fsSL https://deno.land/install.sh | sh',
      'export PATH="$HOME/.deno/bin:$PATH"',
    )
  }
  if (facts.install !== undefined) script.push(facts.install)
  if (facts.build !== undefined) script.push(facts.build)
  const args = [
    ...(facts.directory === '' ? [] : [quote(facts.directory)]),
    '--fail-on',
    inputs.failOn,
    ...(inputs.baseline === undefined ? [] : ['--baseline', quote(toPosix(inputs.baseline))]),
    // Built a step ago, so nothing to build or start: a run that went looking
    // for the site's server here would be auditing something else.
    ...(facts.directory === '' ? [] : ['--no-build']),
    '--summary',
    'eaa-kit-summary.md',
  ]
  script.push(`npx --yes eaa-kit@${TOOL_VERSION} audit ${args.join(' ')}`)
  return script
}

function artifactPath(facts: ProjectFacts): string {
  return facts.workingDirectory === ''
    ? 'eaa-kit-summary.md'
    : `${facts.workingDirectory}/eaa-kit-summary.md`
}

function gitlabJob(facts: ProjectFacts, inputs: WorkflowInputs): string {
  return [
    '# Written by eaa-kit init. Audits the built site against WCAG 2.2 AA in every',
    '# pipeline and fails the job on barriers at or above --fail-on. The report is',
    '# in the job log, and a Markdown summary is kept as an artifact.',
    '#',
    '# The options are documented at',
    '# https://github.com/likeBloodMoon/eaa-kit/blob/master/docs/integrations.md#gitlab-ci',
    'accessibility:',
    '  image: node:22',
    '  stage: test',
    '  script:',
    ...auditScript(facts, inputs).map((line) => `    - ${yamlItem(line)}`),
    '  artifacts:',
    '    when: always',
    '    expose_as: accessibility summary',
    '    paths:',
    `      - ${artifactPath(facts)}`,
    '',
  ].join('\n')
}

function bitbucketPipeline(facts: ProjectFacts, inputs: WorkflowInputs): string {
  const step = [
    '      - step:',
    '          name: Accessibility',
    '          caches:',
    '            - node',
    '          script:',
    ...auditScript(facts, inputs).map((line) => `            - ${yamlItem(line)}`),
    '          artifacts:',
    `            - ${artifactPath(facts)}`,
  ]
  return [
    '# Written by eaa-kit init. Audits the built site against WCAG 2.2 AA on every',
    '# push and pull request, and fails the step on barriers at or above --fail-on.',
    '# The report is in the step log, and a Markdown summary is kept as an artifact.',
    '#',
    '# The options are documented at',
    '# https://github.com/likeBloodMoon/eaa-kit/blob/master/docs/integrations.md#bitbucket-pipelines',
    'image: node:22',
    '',
    'pipelines:',
    '  default:',
    ...step,
    '  pull-requests:',
    "    '**':",
    ...step.map((line) => `  ${line}`),
    '',
  ].join('\n')
}

/**
 * A command as a YAML list item. Plain where YAML reads it back unchanged; in
 * double quotes where it would not, such as a `: ` that turns it into a map or
 * a ` #` that turns the rest into a comment.
 */
function yamlItem(command: string): string {
  if (!/: |\s#|^[\s'"&*!|>%@`{[]/.test(command)) return command
  return `"${command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** A word for a YAML list item and a shell command at once, quoted only when it has to be. */
function quote(value: string): string {
  return /^[\w./@:+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}
