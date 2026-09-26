import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { autoDetectSource } from '../../src/audit/project.ts'
import { findWorkspaceSites } from '../../src/audit/workspaces.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function repo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-monorepo-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.join(dir, path.dirname(name)), { recursive: true })
    await writeFile(path.join(dir, name), body)
  }
  return dir
}

const app = (deps: Record<string, string>): string => JSON.stringify({ dependencies: deps })

describe('findWorkspaceSites', () => {
  it('reads pnpm-workspace.yaml and keeps the packages that are sites', async () => {
    const dir = await repo({
      'package.json': JSON.stringify({ private: true }),
      'pnpm-workspace.yaml': 'packages:\n  - \'apps/*\'\n  - "packages/*"\n',
      'apps/web/package.json': app({ astro: '5.0.0' }),
      'apps/docs/package.json': app({ '@docusaurus/core': '3.0.0' }),
      'packages/ui/package.json': app({ react: '19.0.0' }),
    })

    const found = await findWorkspaceSites(dir)

    expect(found?.evidence).toBe('pnpm-workspace.yaml')
    expect(found?.sites.map((site) => [site.dir, site.framework.framework.name])).toEqual([
      ['apps/docs', 'Docusaurus'],
      ['apps/web', 'Astro'],
    ])
  })

  it('reads npm and yarn workspaces from package.json, as an array or as packages', async () => {
    const npm = await repo({
      'package.json': JSON.stringify({ workspaces: ['sites/*'] }),
      'sites/shop/package.json': app({ next: '16.0.0' }),
    })
    const yarn = await repo({
      'package.json': JSON.stringify({ workspaces: { packages: ['sites/*'] } }),
      'sites/shop/package.json': app({ nuxt: '4.0.0' }),
    })

    expect((await findWorkspaceSites(npm))?.sites.map((site) => site.dir)).toEqual(['sites/shop'])
    expect((await findWorkspaceSites(yarn))?.sites.map((site) => site.dir)).toEqual(['sites/shop'])
  })

  it("takes Turborepo's and Nx's usual layout when nothing lists the packages", async () => {
    const dir = await repo({
      'package.json': '{}',
      'nx.json': '{}',
      'apps/site/package.json': app({ '@angular/core': '19.0.0' }),
    })

    const found = await findWorkspaceSites(dir)

    expect(found?.evidence).toBe('nx.json')
    expect(found?.sites.map((site) => site.dir)).toEqual(['apps/site'])
  })

  it('does not count a Vite library as a site', async () => {
    // Vite builds libraries as well as apps; an app has an index.html.
    const dir = await repo({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/lib/package.json': app({ vite: '6.0.0' }),
      'packages/app/package.json': app({ vite: '6.0.0' }),
      'packages/app/index.html': '<!doctype html>',
    })

    expect((await findWorkspaceSites(dir))?.sites.map((site) => site.dir)).toEqual(['packages/app'])
  })

  it('never looks inside node_modules', async () => {
    const dir = await repo({
      'package.json': JSON.stringify({ workspaces: ['**'] }),
      'node_modules/astro/package.json': app({ astro: '5.0.0' }),
    })

    expect((await findWorkspaceSites(dir))?.sites).toEqual([])
  })

  it('is not a monorepo without workspaces', async () => {
    expect(await findWorkspaceSites(await repo({ 'package.json': '{}' }))).toBeUndefined()
  })
})

describe('auditing from the root of a monorepo', () => {
  it('audits the one site there is', async () => {
    const dir = await repo({
      'package.json': JSON.stringify({ workspaces: ['apps/*'] }),
      'apps/web/package.json': app({ astro: '5.0.0' }),
      'apps/web/dist/index.html': '<html></html>',
      'packages/ui/package.json': '{}',
    })

    const detected = await autoDetectSource(dir, { noBuild: true })

    expect(detected?.directory).toBe(path.join(dir, 'apps/web/dist'))
    expect(detected?.steps[0]).toBe('This is a monorepo with one site, in apps/web/')
  })

  it('lists the sites and how to audit each when there are several', async () => {
    const dir = await repo({
      'package.json': JSON.stringify({ workspaces: ['apps/*'] }),
      'apps/web/package.json': app({ astro: '5.0.0' }),
      'apps/docs/package.json': app({ vitepress: '1.0.0' }),
    })

    const detected = await autoDetectSource(dir, { noBuild: true })

    expect(detected?.directory).toBeUndefined()
    expect(detected?.url).toBeUndefined()
    expect(detected?.sites).toEqual(['apps/docs', 'apps/web'])
    expect(detected?.steps.join('\n')).toContain('This is a monorepo with 2 sites')
  })
})
