import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * What a Next.js build says about its own pages.
 *
 * A plain `next build` writes no browsable HTML anywhere this tool can audit
 * as files: the prerendered pages under `.next/server` link to
 * `/_next/static/…`, which exists at that path only when `next start` serves
 * it, so auditing them off disk would audit pages without their CSS and get
 * contrast wrong. The only honest view of the site is the one `next start`
 * serves.
 *
 * Following links from the home page then finds what the navigation links to,
 * which is not the site. Next already wrote down every page it built, in the
 * manifests beside the build, so those are read instead and the crawl is
 * seeded from them: a page nothing links to is still audited, and a dynamic
 * route that renders on request is named as not audited rather than silently
 * missed.
 *
 * The manifest formats are internal to Next and have changed between majors.
 * Every field here is read defensively, and the fixtures in
 * `tests/fixtures/stacks/next-*` are copied from real builds, so a format
 * change shows up as a failing test rather than a quietly shorter audit.
 */

const CONFIG_FILES = ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next.config.cjs']

export interface NextConfigFacts {
  /** The config file the facts were read from. */
  file?: string
  output?: 'export' | 'standalone'
  distDir?: string
  basePath?: string
  trailingSlash?: boolean
}

/**
 * The facts in `next.config.*` that decide how to audit the site.
 *
 * Read with patterns rather than executed, for the reason `outputFromConfig`
 * gives: a config file is code, and this runs before anything has decided the
 * project is trustworthy. A value computed at runtime is simply not seen,
 * which leaves the default, which is what the caller would do anyway.
 */
export async function readNextConfig(cwd: string): Promise<NextConfigFacts> {
  for (const file of CONFIG_FILES) {
    let source: string
    try {
      source = await readFile(path.join(cwd, file), 'utf8')
    } catch {
      continue
    }
    const string = (key: string): string | undefined =>
      new RegExp(`\\b${key}\\s*:\\s*['"\`]([^'"\`]*)['"\`]`).exec(source)?.[1]
    const facts: NextConfigFacts = { file }
    const output = string('output')
    if (output === 'export' || output === 'standalone') facts.output = output
    const distDir = string('distDir')
    if (distDir !== undefined && distDir !== '' && !path.isAbsolute(distDir)) {
      facts.distDir = distDir.replace(/^\.\//, '').replace(/\/$/, '')
    }
    const basePath = string('basePath')
    if (basePath !== undefined && basePath !== '') facts.basePath = basePath.replace(/\/$/, '')
    if (/\btrailingSlash\s*:\s*true\b/.test(source)) facts.trailingSlash = true
    return facts
  }
  return {}
}

export interface NextRoutes {
  /** `basePath`, or '' when there is none. Every path below is under it. */
  basePath: string
  /** Every page the build knows the address of, sorted, without the basePath. */
  pages: string[]
  /** Dynamic page routes with no page built ahead of time, e.g. `/user/[id]`. */
  dynamic: string[]
  trailingSlash: boolean
}

/**
 * Every page a `next build` produced or can serve at a known address.
 *
 * Undefined when there is no build to read, which the caller takes as "build
 * first".
 */
export async function nextRoutes(cwd: string): Promise<NextRoutes | undefined> {
  const config = await readNextConfig(cwd)
  const dist = path.join(cwd, config.distDir ?? '.next')

  const routesManifest = await readJson<{
    basePath?: string
    i18n?: { defaultLocale?: string }
  }>(path.join(dist, 'routes-manifest.json'))
  const prerender = await readJson<{
    routes?: Record<string, unknown>
    dynamicRoutes?: Record<string, unknown>
  }>(path.join(dist, 'prerender-manifest.json'))
  if (routesManifest === undefined && prerender === undefined) return undefined

  const pagesManifest =
    (await readJson<Record<string, string>>(path.join(dist, 'server', 'pages-manifest.json'))) ?? {}
  const appPaths =
    (await readJson<Record<string, string>>(path.join(dist, 'app-path-routes-manifest.json'))) ?? {}

  const defaultLocale = routesManifest?.i18n?.defaultLocale

  // Next serves the default locale without its prefix, and the prefixed path
  // is the same page: listing both would audit it twice.
  const unprefixed = (route: string): string => {
    if (defaultLocale === undefined) return route
    if (route === `/${defaultLocale}`) return '/'
    if (route.startsWith(`/${defaultLocale}/`)) return route.slice(defaultLocale.length + 1)
    return route
  }

  const candidates = [
    ...Object.keys(prerender?.routes ?? {}),
    ...Object.keys(pagesManifest),
    // App router: keys are the files (`/about/page`), values the routes. Only
    // pages count; `/route` entries are API handlers and metadata files.
    ...Object.entries(appPaths)
      .filter(([file]) => file.endsWith('/page'))
      .map(([, route]) => route),
  ].map(unprefixed)

  const isPage = (route: string): boolean => {
    const segments = route.split('/').filter(Boolean)
    if (segments[0] === 'api') return false
    // /_app, /_document, /_error, /_not-found, /_global-error: never a page a
    // visitor is sent to.
    if (segments.some((segment) => segment.startsWith('_'))) return false
    if (/^(404|500)$/.test(segments.at(-1) ?? '')) return false
    // robots.txt, sitemap.xml, an Open Graph image: files, not pages.
    if (/\.[a-z0-9]+$/i.test(segments.at(-1) ?? '')) return false
    return true
  }

  const known = new Set(candidates.filter(isPage))
  const pages = [...known].filter((route) => !route.includes('[')).sort()

  // A dynamic route whose pages were prerendered has them listed above. One
  // with none is rendered on request, and the only record of which pages it
  // has is whatever links to them.
  const withPages = new Set(Object.keys(prerender?.dynamicRoutes ?? {}).map(unprefixed))
  const dynamic = [...known].filter((route) => route.includes('[') && !withPages.has(route)).sort()

  return {
    basePath: (routesManifest?.basePath ?? config.basePath ?? '').replace(/\/$/, ''),
    pages,
    dynamic,
    trailingSlash: config.trailingSlash === true,
  }
}

/** The page's address on a running server, basePath and trailing slash included. */
export function nextPageUrl(origin: string, routes: NextRoutes, page: string): string {
  let pathname = `${routes.basePath}${page === '/' ? '' : page}` || '/'
  if (routes.trailingSlash && !pathname.endsWith('/')) pathname += '/'
  return new URL(pathname, origin).href
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return undefined
  }
}
