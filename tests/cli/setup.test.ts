import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInitCommand } from '../../src/cli/init.ts'
import { findGitRoot, WORKFLOW_FILE, workflowFor } from '../../src/cli/setup.ts'
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

  it('installs and builds nothing for a site written by hand', async () => {
    const root = await repo({ '.git/HEAD': 'ref: refs/heads/main\n', 'index.html': PAGE })

    const yaml = await workflowFor({ cwd: root, root, site: root, failOn: 'serious' })

    expect(yaml).not.toContain('install-command')
    expect(yaml).not.toContain('build-command')
    expect(yaml).toContain('directory: .')
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

  it('offers no workflow outside a git repository', async () => {
    const cwd = await repo({ 'index.html': PAGE })

    await runInitCommand({ cwd, yes: true, baseline: false })

    await expect(readFile(path.join(cwd, WORKFLOW_FILE), 'utf8')).rejects.toThrow()
  })
})
