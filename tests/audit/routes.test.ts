import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRouteMap, routePathFor, sourceFor } from '../../src/audit/routes.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function project(files: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-routes-'))
  dirs.push(dir)
  for (const name of files) {
    await mkdir(path.join(dir, path.dirname(name)), { recursive: true })
    await writeFile(path.join(dir, name), '')
  }
  return dir
}

describe('routePathFor', () => {
  it.each([
    ['page.tsx', ''],
    ['kontakt/page.tsx', 'kontakt'],
    ['blog/page.jsx', 'blog'],
    ['a/b/page.mdx', 'a/b'],
  ])('next-app %s -> %s', (file, expected) => {
    expect(routePathFor(file, 'next-app')).toBe(expected)
  })

  it('treats a route group as contributing no segment', () => {
    // app/(marketing)/preise/page.tsx serves /preise — the group is an
    // organisational folder, not part of the URL.
    expect(routePathFor('(marketing)/preise/page.tsx', 'next-app')).toBe('preise')
  })

  it.each(['blog/[slug]/page.tsx', '[...all]/page.tsx', 'shop/[[...x]]/page.tsx'])(
    'refuses to map the dynamic route %s',
    (file) => {
      // A dynamic segment serves many paths. Picking one would be a guess, and
      // a wrong source file is worse than none.
      expect(routePathFor(file, 'next-app')).toBeUndefined()
    },
  )

  it('refuses a private folder', () => {
    expect(routePathFor('_components/page.tsx', 'next-app')).toBeUndefined()
  })

  it.each([
    ['index.tsx', ''],
    ['kontakt.tsx', 'kontakt'],
    ['blog/index.jsx', 'blog'],
  ])('next-pages %s -> %s', (file, expected) => {
    expect(routePathFor(file, 'next-pages')).toBe(expected)
  })

  it.each([
    ['+page.svelte', ''],
    ['about/+page.svelte', 'about'],
  ])('sveltekit %s -> %s', (file, expected) => {
    expect(routePathFor(file, 'sveltekit')).toBe(expected)
  })
})

describe('buildRouteMap', () => {
  it('maps a Next.js app router project', async () => {
    const dir = await project(['app/page.tsx', 'app/kontakt/page.tsx'])

    const map = await buildRouteMap(dir)

    expect(map?.framework).toBe('next-app')
    expect(sourceFor(map, 'index.html')).toBe('app/page.tsx')
    expect(sourceFor(map, 'kontakt.html')).toBe('app/kontakt/page.tsx')
  })

  it('maps the several page paths one route can be emitted as', async () => {
    const dir = await project(['app/kontakt/page.tsx'])
    const map = await buildRouteMap(dir)

    // Builders disagree about trailing slashes and index files; the route is
    // the same one either way.
    for (const emitted of ['kontakt', 'kontakt/', 'kontakt.html', 'kontakt/index.html']) {
      expect(sourceFor(map, emitted)).toBe('app/kontakt/page.tsx')
    }
  })

  it('finds the app directory under src/', async () => {
    const map = await buildRouteMap(await project(['src/app/page.tsx']))

    expect(sourceFor(map, 'index.html')).toBe('src/app/page.tsx')
  })

  it.each([
    ['astro', 'src/pages/index.astro'],
    ['nuxt', 'pages/index.vue'],
    ['sveltekit', 'src/routes/+page.svelte'],
  ])('recognises a %s project', async (framework, file) => {
    const map = await buildRouteMap(await project([file]))

    expect(map?.framework).toBe(framework)
    expect(sourceFor(map, 'index.html')).toBe(file)
  })

  it('leaves out a dynamic route rather than guessing', async () => {
    const map = await buildRouteMap(await project(['app/page.tsx', 'app/blog/[slug]/page.tsx']))

    expect(sourceFor(map, 'index.html')).toBe('app/page.tsx')
    expect(sourceFor(map, 'blog/hello.html')).toBeUndefined()
  })

  it('returns nothing for a project using no convention it knows', async () => {
    expect(await buildRouteMap(await project(['index.html', 'style.css']))).toBeUndefined()
  })

  it('reports no source for a page it has no route for', async () => {
    const map = await buildRouteMap(await project(['app/page.tsx']))

    expect(sourceFor(map, '404.html')).toBeUndefined()
    expect(sourceFor(undefined, 'index.html')).toBeUndefined()
  })
})
