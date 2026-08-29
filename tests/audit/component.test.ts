import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildComponentIndex, componentFor, searchTermsFor } from '../../src/audit/component.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'eaa-kit-comp-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.join(dir, path.dirname(name)), { recursive: true })
    await writeFile(path.join(dir, name), body)
  }
  return dir
}

describe('searchTermsFor', () => {
  it('prefers an image path, which is written by hand and survives compilation', () => {
    expect(searchTermsFor('<img src="/assets/logo.png">')[0]).toBe('/assets/logo.png')
  })

  it.each([
    ['<a href="/kontakt"></a>', '/kontakt'],
    ['<div id="main-nav"></div>', 'main-nav'],
    ['<form action="/subscribe"></form>', '/subscribe'],
  ])('reads %s', (html, expected) => {
    expect(searchTermsFor(html)).toContain(expected)
  })

  it('drops anything too short to identify a file', () => {
    // "/" appears in every source file there is.
    expect(searchTermsFor('<a href="/"></a>')).toEqual([])
  })

  it('drops an interpolated value, which appears nowhere as written', () => {
    expect(searchTermsFor('<img src="${logoUrl}">')).toEqual([])
  })

  it('falls back to text content, but puts it last', () => {
    const terms = searchTermsFor('<a href="/pricing">See our pricing plans</a>')

    expect(terms[0]).toBe('/pricing')
    expect(terms.at(-1)).toContain('See our pricing plans')
  })
})

describe('componentFor', () => {
  it('names the component a shared element was written in', async () => {
    // The gap this closes: route mapping names the page, and a header with a
    // missing alt is written in none of the pages that render it.
    const index = await buildComponentIndex(
      await project({
        'components/Header.jsx': 'export default () => <img src="/logo.png" />',
        'app/page.jsx': "import Header from '../components/Header'",
      }),
    )

    expect(componentFor(index, '<img src="/logo.png">')).toBe('components/Header.jsx')
  })

  it('names nothing when two files could be it', async () => {
    // A wrong file sends somebody to edit code that was not the cause, which
    // costs more than the minute it saved.
    const index = await buildComponentIndex(
      await project({
        'components/Header.jsx': '<img src="/logo.png" />',
        'components/Footer.jsx': '<img src="/logo.png" />',
      }),
    )

    expect(componentFor(index, '<img src="/logo.png">')).toBeUndefined()
  })

  it('falls through to a less distinctive term when the first is ambiguous', async () => {
    const index = await buildComponentIndex(
      await project({
        'a.jsx': '<img src="/logo.png" />',
        'b.jsx': '<img src="/logo.png" id="brand-mark" />',
      }),
    )

    expect(componentFor(index, '<img src="/logo.png" id="brand-mark">')).toBe('b.jsx')
  })

  it('names nothing when the markup is nowhere in the source', async () => {
    const index = await buildComponentIndex(await project({ 'a.jsx': 'export default 1' }))

    expect(componentFor(index, '<img src="/logo.png">')).toBeUndefined()
  })

  it.each(['node_modules/pkg/index.js', 'dist/index.js', '.next/server/page.js'])(
    'does not search %s',
    async (file) => {
      // Build output contains the same markup as the source that produced it,
      // and naming a compiled file helps nobody.
      const index = await buildComponentIndex(await project({ [file]: '<img src="/logo.png" />' }))

      expect(componentFor(index, '<img src="/logo.png">')).toBeUndefined()
    },
  )

  it.each(['Header.vue', 'Header.svelte', 'Header.astro', 'Header.tsx'])(
    'searches %s',
    async (file) => {
      const index = await buildComponentIndex(await project({ [file]: '<img src="/logo.png">' }))

      expect(componentFor(index, '<img src="/logo.png">')).toBe(file)
    },
  )
})
