import { describe, expect, it } from 'vitest'
import { isAppShell } from '../../src/audit/shell.ts'

const doc = (body: string, head = '<title>App</title>'): string =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`

describe('isAppShell', () => {
  it.each([
    ['a Vite app', '<div id="root"></div><script type="module" src="/assets/index.js"></script>'],
    ['a Vue app', '<div id="app"></div>'],
    ['an Angular app', '<app-root></app-root>'],
    ['a Nuxt SPA fallback', '<div id="__nuxt"></div><script>window.__NUXT__={}</script>'],
    [
      'one that apologises without JavaScript',
      '<noscript>You need to enable JavaScript to run this app.</noscript><div id="root"></div>',
    ],
  ])('recognises %s: nothing a visitor could perceive until a script runs', (_name, body) => {
    expect(isAppShell(doc(body))).toBe(true)
  })

  it.each([
    ['a page with text', '<main><h1>Hello</h1></main>'],
    ['a prerendered app', '<div id="root"><h1>Home</h1><p>Welcome</p></div>'],
    ['a page that is only an image', '<img src="/hero.png" alt="">'],
    ['a page with a form control', '<div id="app"><input type="search"></div>'],
    ['an embedded frame', '<iframe src="/x" title="x"></iframe>'],
  ])('audits %s', (_name, body) => {
    expect(isAppShell(doc(body))).toBe(false)
  })

  it('does not count what is in the head, or in a template', () => {
    expect(isAppShell(doc('<template><h1>Later</h1></template><div id="root"></div>'))).toBe(true)
  })
})

describe('isAppShell on hostile markup', () => {
  // Every crawled page goes through here, whoever wrote it. The patterns this
  // used to be ran to the end of the page from every unclosed tag.
  it.each([
    ['unclosed styles', `<html><body>${'<style x>'.repeat(40_000)}text`],
    ['unclosed comments', `<html><body>${'<!--'.repeat(80_000)}`],
    ['bare angle brackets', `<html><body>${'<'.repeat(300_000)}`],
    ['repeated heads', `${'<head>'.repeat(60_000)}<p>x</p>`],
    ['repeated bodies', `${'<body>'.repeat(60_000)}`],
  ])('stays fast on %s', (_name, html) => {
    const started = performance.now()
    isAppShell(html)
    expect(performance.now() - started).toBeLessThan(250)
  })

  it('does not take a <header> for the end of the head', () => {
    expect(isAppShell('<head><title>t</title><header>Site</header></head>')).toBe(true)
    expect(isAppShell('<head><title>t</title></head><header>Site</header>')).toBe(false)
  })
})
