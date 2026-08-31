import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRouteMap, routePathFor, sourceFor } from '../../src/audit/routes.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function project(files: string[], pkg?: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-routes-'))
  dirs.push(dir)
  for (const name of files) {
    await mkdir(path.join(dir, path.dirname(name)), { recursive: true })
    await writeFile(path.join(dir, name), '')
  }
  if (pkg !== undefined) {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg))
  }
  return dir
}

/** A package.json naming one dependency, which is how the registry identifies most builders. */
function dependsOn(name: string): Record<string, unknown> {
  return { name: 'fixture', dependencies: { [name]: '1.0.0' } }
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

describe('remix flat routes', () => {
  it.each([
    ['_index.tsx', ''],
    ['about.tsx', 'about'],
    ['blog.post.tsx', 'blog/post'],
    ['blog._index.tsx', 'blog'],
    ['blog.post/route.tsx', 'blog/post'],
  ])('%s -> %s', (file, expected) => {
    expect(routePathFor(file, 'remix')).toBe(expected)
  })

  it('treats a trailing underscore as a layout escape, not part of the URL', () => {
    // blog_.post.tsx opts out of the blog layout and still serves /blog/post.
    expect(routePathFor('blog_.post.tsx', 'remix')).toBe('blog/post')
  })

  it.each(['blog.$slug.tsx', '$.tsx', 'files.$.tsx'])('refuses the dynamic route %s', (file) => {
    expect(routePathFor(file, 'remix')).toBeUndefined()
  })
})

describe('documentation trees', () => {
  it.each([
    ['index.md', ''],
    ['guide/intro.md', 'guide/intro'],
    ['guide/index.md', 'guide'],
  ])('vitepress %s -> %s', (file, expected) => {
    expect(routePathFor(file, 'vitepress')).toBe(expected)
  })

  it('serves docusaurus docs under /docs by default', () => {
    expect(routePathFor('intro.md', 'docusaurus')).toBe('docs/intro')
    expect(routePathFor('index.md', 'docusaurus')).toBe('docs')
  })

  it.each([
    ['index.md', ''],
    ['reference/cli.mdx', 'reference/cli'],
  ])('starlight %s -> %s', (file, expected) => {
    expect(routePathFor(file, 'starlight')).toBe(expected)
  })
})

describe('hugo content', () => {
  it.each([
    ['_index.md', ''],
    ['posts/hello.md', 'posts/hello'],
    ['posts/_index.md', 'posts'],
  ])('%s -> %s', (file, expected) => {
    expect(routePathFor(file, 'hugo')).toBe(expected)
  })
})

describe('choosing between conventions that claim the same directory', () => {
  it('calls a Gatsby project gatsby, not next-pages', async () => {
    // src/pages belongs to Next, Astro, Gatsby and Vue alike. Probing for it in
    // declaration order labelled every one of them next-pages: the mapping was
    // right and the name was wrong.
    const dir = await project(['src/pages/index.tsx'], dependsOn('gatsby'))

    const map = await buildRouteMap(dir)

    expect(map?.framework).toBe('gatsby')
    expect(sourceFor(map, 'index.html')).toBe('src/pages/index.tsx')
  })

  it('still calls a Next project next-pages for the same directory', async () => {
    const dir = await project(['src/pages/index.tsx'], dependsOn('next'))

    expect((await buildRouteMap(dir))?.framework).toBe('next-pages')
  })

  it('prefers the Starlight content tree over src/pages in an Astro project', async () => {
    const dir = await project(['src/content/docs/index.md'], dependsOn('astro'))

    const map = await buildRouteMap(dir)

    expect(map?.framework).toBe('starlight')
    expect(sourceFor(map, 'index.html')).toBe('src/content/docs/index.md')
  })

  it('falls back to probing when the registry knows nothing about the project', async () => {
    // Most builds are not framework projects, and a map is better than no map.
    const dir = await project(['app/page.tsx'])

    expect((await buildRouteMap(dir))?.framework).toBe('next-app')
  })
})

describe('the new conventions end to end', () => {
  it('maps a Remix project', async () => {
    const dir = await project(
      ['app/routes/_index.tsx', 'app/routes/blog.post.tsx'],
      dependsOn('@remix-run/react'),
    )

    const map = await buildRouteMap(dir)

    expect(map?.framework).toBe('remix')
    expect(sourceFor(map, 'index.html')).toBe('app/routes/_index.tsx')
    expect(sourceFor(map, 'blog/post.html')).toBe('app/routes/blog.post.tsx')
  })

  it('maps a Docusaurus project under its default base path', async () => {
    const dir = await project(['docs/intro.md'], dependsOn('@docusaurus/core'))

    const map = await buildRouteMap(dir)

    expect(map?.framework).toBe('docusaurus')
    expect(sourceFor(map, 'docs/intro/index.html')).toBe('docs/intro.md')
  })

  it('maps a Hugo content tree', async () => {
    const dir = await project(['content/posts/hello.md', 'hugo.toml'])

    const map = await buildRouteMap(dir)

    expect(map?.framework).toBe('hugo')
    expect(sourceFor(map, 'posts/hello/index.html')).toBe('content/posts/hello.md')
  })
})
