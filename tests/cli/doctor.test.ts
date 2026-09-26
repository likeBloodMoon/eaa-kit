import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { type DoctorCheck, nodeSatisfies, runDoctor } from '../../src/cli/doctor.ts'

const STACKS = fileURLToPath(new URL('../fixtures/stacks/', import.meta.url))
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function stack(name: string, extra: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-doctor-'))
  dirs.push(dir)
  await cp(path.join(STACKS, name), dir, { recursive: true })
  for (const [file, body] of Object.entries(extra)) {
    await mkdir(path.join(dir, path.dirname(file)), { recursive: true })
    await writeFile(path.join(dir, file), body)
  }
  return dir
}

/** Everything outside the project answered the healthy way, unless told otherwise. */
const healthy = {
  nodeVersion: '22.22.2',
  onPath: async () => true,
  chromium: async () => ({ status: 'ok' as const, detail: 'Chromium 140' }),
}

const check = (checks: DoctorCheck[], label: string): DoctorCheck | undefined =>
  checks.find((item) => item.label === label)

const config = await readFile(
  fileURLToPath(new URL('../../examples/eaa.config.json', import.meta.url)),
  'utf8',
)

describe('nodeSatisfies', () => {
  it.each([
    ['22.22.2', true],
    ['22.23.0', true],
    ['22.18.0', false],
    ['24.15.0', true],
    ['24.1.0', false],
    ['26.0.0', true],
    ['27.3.1', true],
    ['20.19.0', false],
  ])('reads %s against the engines range as %s', (version, ok) => {
    expect(nodeSatisfies(version, '^22.22.2 || ^24.15.0 || >=26.0.0')).toBe(ok)
  })
})

describe('eaa-kit doctor', () => {
  it('passes a project that is ready, and exits 0', async () => {
    const dir = await stack('astro', {
      'eaa.config.json': config,
      '.github/workflows/accessibility.yml': 'uses: likeBloodMoon/eaa-kit@v0.10.0',
      'eaa-baseline.json': JSON.stringify({ schemaVersion: 2, entries: [] }),
    })

    const result = await runDoctor(dir, healthy)

    expect(result.checks.filter((item) => item.status !== 'ok')).toEqual([])
    expect(result.exitCode).toBe(0)
    expect(result.checks.every((item) => item.status === 'ok')).toBe(true)
  })

  it('fails on a Node too old to run this, and says so first', async () => {
    const result = await runDoctor(await stack('astro'), { ...healthy, nodeVersion: '20.11.0' })

    expect(result.exitCode).toBe(2)
    expect(result.checks[0]).toMatchObject({ label: 'Node.js', status: 'fail' })
  })

  it("fails when the project's package manager is not installed", async () => {
    const result = await runDoctor(await stack('astro'), { ...healthy, onPath: async () => false })

    expect(check(result.checks, 'Package manager')).toMatchObject({
      status: 'fail',
      fix: 'corepack enable',
    })
  })

  it('fails on a config that does not parse, and names the file', async () => {
    const result = await runDoctor(
      await stack('astro', { 'eaa.config.json': '{"site": 1' }),
      healthy,
    )

    expect(check(result.checks, 'Config')).toMatchObject({ status: 'fail' })
    expect(check(result.checks, 'Config')?.detail).toContain('eaa.config.json')
    expect(result.exitCode).toBe(2)
  })

  it('suggests init where there is no config, CI or baseline, without failing', async () => {
    const result = await runDoctor(await stack('astro'), healthy)

    for (const label of ['Config', 'CI', 'Baseline']) {
      expect(check(result.checks, label)).toMatchObject({ status: 'warn', fix: 'npx eaa-kit init' })
    }
    expect(result.exitCode).toBe(0)
  })

  it('warns about baseline entries that have expired', async () => {
    const baseline = JSON.stringify({
      schemaVersion: 2,
      entries: [
        { page: 'index.html', ruleId: 'image-alt', fingerprint: 'img', expiresOn: '2020-01-01' },
      ],
    })
    const result = await runDoctor(await stack('astro', { 'eaa-baseline.json': baseline }), healthy)

    expect(check(result.checks, 'Baseline')).toMatchObject({ status: 'warn' })
    expect(check(result.checks, 'Baseline')?.detail).toContain('1 entry has expired')
  })

  it('fails when there is nothing it could audit', async () => {
    const result = await runDoctor(await stack('mkdocs'), healthy)

    expect(check(result.checks, 'Site')).toMatchObject({ status: 'fail', fix: 'mkdocs build' })
  })

  it('finds a GitLab or Bitbucket pipeline as well as a GitHub workflow', async () => {
    const gitlab = await runDoctor(
      await stack('astro', { '.gitlab-ci.yml': 'script: npx eaa-kit audit' }),
      healthy,
    )

    expect(check(gitlab.checks, 'CI')).toMatchObject({ status: 'ok', detail: '.gitlab-ci.yml' })
  })

  it('treats browser mode as optional', async () => {
    const result = await runDoctor(await stack('astro'), {
      ...healthy,
      chromium: async () => ({ status: 'skip' as const, detail: 'Playwright not installed' }),
    })

    expect(check(result.checks, 'Browser mode')).toMatchObject({ status: 'skip' })
    expect(result.exitCode).toBe(0)
  })
})
