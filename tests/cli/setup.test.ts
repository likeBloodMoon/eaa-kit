import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { runInitCommand } from '../../src/cli/init.ts'
import {
  BITBUCKET_FILE,
  detectCiHost,
  findGitRoot,
  GITLAB_FILE,
  GITLAB_INCLUDED_FILE,
  pipelineFor,
  pipelinePlan,
  WORKFLOW_FILE,
  workflowFor,
} from '../../src/cli/setup.ts'
import { TOOL_VERSION } from '../../src/version.ts'

const dirs: string[] = []

beforeEach(() => {
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function repo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-setup-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.join(dir, path.dirname(name)), { recursive: true })
    await writeFile(path.join(dir, name), body)
  }
  return dir
}

const PAGE =
  '<!doctype html><html lang="de-AT"><head><title>S</title></head><body><main><h1>S</h1><img src="a.png"></main></body></html>'

/** Answers in order; anything not given takes the default, as enter does. */
function answers(...given: string[]): (question: string, fallback: string) => Promise<string> {
  let next = 0
  return async (_question, fallback) => {
    const answer = given[next++]
    return answer === undefined || answer === '' ? fallback : answer
  }
}

describe('workflowFor', () => {
  it('is written for the project: its package manager, build, directory and baseline', async () => {
    const root = await repo({
      '.git/HEAD': 'ref: refs/heads/trunk\n',
      'package.json': JSON.stringify({ scripts: { build: 'astro build' } }),
      'pnpm-lock.yaml': '',
    })

    const yaml = await workflowFor({
      cwd: root,
      root,
      site: path.join(root, 'dist'),
      baseline: 'eaa-baseline.json',
      failOn: 'serious',
    })

    expect(yaml).toContain('branches: [trunk]')
    expect(yaml).toContain('uses: pnpm/action-setup@v4')
    // No packageManager field, so the version action-setup needs is given.
    expect(yaml).toContain('version: 10')
    expect(yaml).toContain('install-command: pnpm install --frozen-lockfile')
    expect(yaml).toContain('build-command: pnpm run build')
    expect(yaml).toContain('directory: dist')
    expect(yaml).toContain('baseline: eaa-baseline.json')
    expect(yaml).toContain(`uses: likeBloodMoon/eaa-kit@v${TOOL_VERSION}`)
    expect(yaml).toContain('security-events: write')
  })

  it('runs from the package in a monorepo, and leaves an unknown directory to the action', async () => {
    const root = await repo({
      '.git/HEAD': 'ref: refs/heads/main\n',
      'apps/web/package.json': JSON.stringify({ scripts: { build: 'next build' } }),
      'apps/web/package-lock.json': '{}',
    })

    const yaml = await workflowFor({
      cwd: path.join(root, 'apps', 'web'),
      root,
      failOn: 'critical',
    })

    expect(yaml).toContain('working-directory: apps/web')
    expect(yaml).toContain('install-command: npm ci')
    expect(yaml).not.toContain('pnpm/action-setup')
    expect(yaml).toContain("directory: ''")
    expect(yaml).toContain('fail-on: critical')
  })

  it('sets up Deno for a Deno project with no package.json, and runs its build task', async () => {
    // A native Deno site has deno.json and deno.lock and nothing for npm.
    const root = await repo({
      '.git/HEAD': 'ref: refs/heads/main\n',
      'deno.json': JSON.stringify({ tasks: { build: 'deno run -A build.ts' } }),
      'deno.lock': '{}',
    })

    const yaml = await workflowFor({ cwd: root, root, failOn: 'serious' })

    expect(yaml).toContain('uses: denoland/setup-deno@v2')
    expect(yaml).toContain('build-command: deno task build')
  })

  it('writes no install step for Deno, whose tasks fetch their own dependencies', async () => {
    // `deno install` with a flag and no module is not a dependency install on
    // every Deno version, and a failing first step stops the whole workflow.
    const root = await repo({
      '.git/HEAD': 'ref: refs/heads/main\n',
      'package.json': JSON.stringify({ scripts: { build: 'vite build' } }),
      'deno.lock': '{}',
    })

    const yaml = await workflowFor({ cwd: root, root, failOn: 'serious' })

    expect(yaml).not.toContain('install-command')
    expect(yaml).toContain('build-command: deno task build')
  })

  it('reads deno.jsonc, comments and all', async () => {
    const root = await repo({
      '.git/HEAD': 'ref: refs/heads/main\n',
      'deno.jsonc': '{\n  // how the site is built\n  "tasks": { "build": "lume" }\n}\n',
    })

    expect(await workflowFor({ cwd: root, root, failOn: 'serious' })).toContain(
      'build-command: deno task build',
    )
  })

  it('installs and builds nothing for a site written by hand', async () => {
    const root = await repo({ '.git/HEAD': 'ref: refs/heads/main\n', 'index.html': PAGE })

    const yaml = await workflowFor({ cwd: root, root, site: root, failOn: 'serious' })

    expect(yaml).not.toContain('install-command')
    expect(yaml).not.toContain('build-command')
    expect(yaml).toContain('directory: .')
  })
})

const config = (url: string, name = 'origin') =>
  `[core]\n\tbare = false\n[remote "${name}"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/${name}/*\n`

describe('detectCiHost', () => {
  it.each([
    ['https://github.com/acme/site.git', 'github'],
    ['git@github.com:acme/site.git', 'github'],
    ['https://gitlab.com/acme/site.git', 'gitlab'],
    ['git@gitlab.example.at:agency/site.git', 'gitlab'],
    ['ssh://git@gitlab.internal:2222/agency/site.git', 'gitlab'],
    ['https://bitbucket.org/acme/site.git', 'bitbucket'],
    ['git@bitbucket.org:acme/site.git', 'bitbucket'],
  ])('reads %s as %s', async (url, host) => {
    const root = await repo({ '.git/config': config(url) })

    expect(await detectCiHost(root)).toBe(host)
  })

  it('prefers origin to any other remote', async () => {
    const root = await repo({
      '.git/config':
        config('https://github.com/mirror/site.git', 'mirror') +
        config('https://gitlab.com/acme/site.git'),
    })

    expect(await detectCiHost(root)).toBe('gitlab')
  })

  it('falls back to the pipeline file already there, then to GitHub', async () => {
    expect(await detectCiHost(await repo({ '.git/HEAD': '', [GITLAB_FILE]: 'x: 1\n' }))).toBe(
      'gitlab',
    )
    expect(await detectCiHost(await repo({ '.git/HEAD': '', [BITBUCKET_FILE]: 'x\n' }))).toBe(
      'bitbucket',
    )
    expect(await detectCiHost(await repo({ '.git/HEAD': '' }))).toBe('github')
    expect(
      await detectCiHost(await repo({ '.git/config': config('https://git.example.com/x.git') })),
    ).toBe('github')
  })
})

describe('pipelinePlan', () => {
  it("writes GitLab's file when there is none, and a file to include when there is", async () => {
    expect(await pipelinePlan(await repo({ '.git/HEAD': '' }), 'gitlab')).toEqual({
      file: GITLAB_FILE,
    })
    expect(await pipelinePlan(await repo({ [GITLAB_FILE]: 'x: 1\n' }), 'gitlab')).toEqual({
      file: GITLAB_INCLUDED_FILE,
      include: '.gitlab/eaa-kit.gitlab-ci.yml',
    })
    const both = await repo({ [GITLAB_FILE]: 'x\n', [GITLAB_INCLUDED_FILE]: 'x\n' })
    expect(await pipelinePlan(both, 'gitlab')).toHaveProperty('refused')
  })

  it('refuses Bitbucket when its one file exists, and names where the step is documented', async () => {
    const plan = await pipelinePlan(await repo({ [BITBUCKET_FILE]: 'x\n' }), 'bitbucket')

    expect(plan).toHaveProperty('refused', expect.stringContaining('docs/integrations.md'))
  })
})

describe('GitLab and Bitbucket pipelines', () => {
  async function project(files: Record<string, string> = {}) {
    return repo({
      '.git/HEAD': 'ref: refs/heads/main\n',
      'package.json': JSON.stringify({ scripts: { build: 'astro build' } }),
      'pnpm-lock.yaml': '',
      ...files,
    })
  }

  it('is a GitLab job that installs, builds and audits this project', async () => {
    const root = await project()
    const yaml = await pipelineFor('gitlab', {
      cwd: root,
      root,
      site: path.join(root, 'dist'),
      baseline: 'eaa-baseline.json',
      failOn: 'serious',
    })
    const job = parse(yaml).accessibility

    expect(job.image).toBe('node:22')
    expect(job.script).toEqual([
      'corepack enable',
      'pnpm install --frozen-lockfile',
      'pnpm run build',
      `npx --yes eaa-kit@${TOOL_VERSION} audit dist --fail-on serious --baseline eaa-baseline.json --no-build --summary eaa-kit-summary.md`,
    ])
    expect(job.artifacts).toMatchObject({ when: 'always', paths: ['eaa-kit-summary.md'] })
  })

  it('runs from the package in a monorepo and keeps the artifact there', async () => {
    const root = await project()
    const cwd = path.join(root, 'apps', 'web')
    await mkdir(cwd, { recursive: true })
    await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { build: 'x' } }))
    await writeFile(path.join(cwd, 'package-lock.json'), '{}')

    const job = parse(await pipelineFor('gitlab', { cwd, root, failOn: 'critical' })).accessibility

    expect(job.script[0]).toBe('cd apps/web')
    expect(job.script.at(-1)).toBe(
      `npx --yes eaa-kit@${TOOL_VERSION} audit --fail-on critical --summary eaa-kit-summary.md`,
    )
    expect(job.artifacts.paths).toEqual(['apps/web/eaa-kit-summary.md'])
  })

  it('is a Bitbucket pipeline that runs on every push and every pull request', async () => {
    const root = await repo({
      '.git/HEAD': 'ref: refs/heads/main\n',
      'package.json': JSON.stringify({ scripts: { build: 'x' } }),
      'bun.lock': '',
    })
    const doc = parse(
      await pipelineFor('bitbucket', {
        cwd: root,
        root,
        site: path.join(root, 'out'),
        failOn: 'serious',
      }),
    )

    const push = doc.pipelines.default[0].step
    const pr = doc.pipelines['pull-requests']['**'][0].step
    expect(pr).toEqual(push)
    expect(push.script).toContain('npm install --global bun')
    expect(push.script).toContain('bun install --frozen-lockfile')
    expect(push.script.at(-1)).toContain('audit out --fail-on serious --no-build')
    expect(push.artifacts).toEqual(['eaa-kit-summary.md'])
  })

  it('quotes a directory the shell or YAML would misread', async () => {
    const root = await project()
    const yaml = await pipelineFor('gitlab', {
      cwd: root,
      root,
      site: path.join(root, 'my site #1'),
      failOn: 'serious',
    })
    const audit = parse(yaml).accessibility.script.at(-1)

    expect(audit).toContain("audit 'my site #1' --fail-on")
  })
})

describe('findGitRoot', () => {
  it('walks up to the repository', async () => {
    const root = await repo({ '.git/HEAD': 'ref: refs/heads/main\n', 'a/b/c.txt': '' })

    expect(await findGitRoot(path.join(root, 'a', 'b'))).toBe(root)
  })
})

describe('eaa-kit init sets up the project', () => {
  it('records a baseline and writes a workflow that reads it', async () => {
    const cwd = await repo({ '.git/HEAD': 'ref: refs/heads/main\n', 'index.html': PAGE })

    const { exitCode } = await runInitCommand({ cwd, ask: answers('', '', '', '', '', 'a@s.at') })

    expect(exitCode).toBe(0)
    const baseline = JSON.parse(await readFile(path.join(cwd, 'eaa-baseline.json'), 'utf8'))
    expect(baseline.entries.length).toBeGreaterThan(0)
    const config = JSON.parse(await readFile(path.join(cwd, 'eaa.config.json'), 'utf8'))
    expect(config.audit).toMatchObject({ baseline: 'eaa-baseline.json' })
    const workflow = await readFile(path.join(cwd, WORKFLOW_FILE), 'utf8')
    expect(workflow).toContain('baseline: eaa-baseline.json')
  })

  it('does neither when told no', async () => {
    const cwd = await repo({ '.git/HEAD': 'ref: refs/heads/main\n', 'index.html': PAGE })

    await runInitCommand({ cwd, ask: answers('', '', '', '', '', 'a@s.at', '', 'n', 'n') })

    await expect(readFile(path.join(cwd, 'eaa-baseline.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(path.join(cwd, WORKFLOW_FILE), 'utf8')).rejects.toThrow()
  })

  it('does not offer them under --no-ci and --no-baseline', async () => {
    const cwd = await repo({ '.git/HEAD': 'ref: refs/heads/main\n', 'index.html': PAGE })

    await runInitCommand({ cwd, yes: true, ci: false, baseline: false })

    await expect(readFile(path.join(cwd, 'eaa-baseline.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(path.join(cwd, WORKFLOW_FILE), 'utf8')).rejects.toThrow()
  })

  it('never overwrites a workflow that is already there', async () => {
    const cwd = await repo({
      '.git/HEAD': 'ref: refs/heads/main\n',
      'index.html': PAGE,
      [WORKFLOW_FILE]: '# mine\n',
    })

    await runInitCommand({ cwd, yes: true, baseline: false })

    expect(await readFile(path.join(cwd, WORKFLOW_FILE), 'utf8')).toBe('# mine\n')
  })

  it('writes a GitLab job for a repository pushed to GitLab', async () => {
    const cwd = await repo({
      '.git/config': config('git@gitlab.com:acme/site.git'),
      'index.html': PAGE,
    })

    await runInitCommand({ cwd, yes: true, baseline: false })

    expect(await readFile(path.join(cwd, GITLAB_FILE), 'utf8')).toContain('accessibility:')
    await expect(readFile(path.join(cwd, WORKFLOW_FILE), 'utf8')).rejects.toThrow()
  })

  it('leaves an existing .gitlab-ci.yml alone and writes a file to include', async () => {
    const cwd = await repo({
      '.git/config': config('https://gitlab.com/acme/site.git'),
      'index.html': PAGE,
      [GITLAB_FILE]: 'stages: [test]\n',
    })

    await runInitCommand({ cwd, yes: true, baseline: false })

    expect(await readFile(path.join(cwd, GITLAB_FILE), 'utf8')).toBe('stages: [test]\n')
    expect(await readFile(path.join(cwd, GITLAB_INCLUDED_FILE), 'utf8')).toContain('accessibility:')
  })

  it('takes --ci over the remote', async () => {
    const cwd = await repo({
      '.git/config': config('https://github.com/acme/site.git'),
      'index.html': PAGE,
    })

    await runInitCommand({ cwd, yes: true, baseline: false, ciHost: 'bitbucket' })

    expect(await readFile(path.join(cwd, BITBUCKET_FILE), 'utf8')).toContain('pipelines:')
    await expect(readFile(path.join(cwd, WORKFLOW_FILE), 'utf8')).rejects.toThrow()
  })

  it('never overwrites bitbucket-pipelines.yml', async () => {
    const cwd = await repo({
      '.git/config': config('https://bitbucket.org/acme/site.git'),
      'index.html': PAGE,
      [BITBUCKET_FILE]: '# mine\n',
    })

    const { exitCode } = await runInitCommand({ cwd, yes: true, baseline: false })

    expect(exitCode).toBe(0)
    expect(await readFile(path.join(cwd, BITBUCKET_FILE), 'utf8')).toBe('# mine\n')
  })

  it('offers no workflow outside a git repository', async () => {
    const cwd = await repo({ 'index.html': PAGE })

    await runInitCommand({ cwd, yes: true, baseline: false })

    await expect(readFile(path.join(cwd, WORKFLOW_FILE), 'utf8')).rejects.toThrow()
  })
})
