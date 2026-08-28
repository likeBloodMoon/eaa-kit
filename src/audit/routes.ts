import { stat } from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'tinyglobby'

/**
 * Which source file produced an audited page.
 *
 * A report that says `leistungen.html` is accurate and unhelpful in a framework
 * project: nobody wrote that file, and the person fixing it has to work out
 * which route it came from before they can open anything. Naming
 * `app/leistungen/page.tsx` turns a finding into somewhere to go.
 *
 * The mapping is derived from the router's own conventions rather than from any
 * build manifest, so it does not depend on internals that change between
 * versions. It is best-effort and never guesses: a page that cannot be matched
 * to exactly one file is reported without a source, which is what it was doing
 * before.
 */

export interface RouteMap {
  /** Framework the map came from, for the report to name. */
  framework: 'next-app' | 'next-pages' | 'nuxt' | 'astro' | 'sveltekit'
  /** Audited page path (POSIX, relative to the build) to source file. */
  sources: Map<string, string>
}

/** Route file conventions, most specific first. */
const CONVENTIONS = [
  { framework: 'next-app', dir: 'app', pattern: '**/page.{tsx,ts,jsx,js,mdx}' },
  { framework: 'next-app', dir: 'src/app', pattern: '**/page.{tsx,ts,jsx,js,mdx}' },
  { framework: 'next-pages', dir: 'pages', pattern: '**/*.{tsx,ts,jsx,js,mdx}' },
  { framework: 'next-pages', dir: 'src/pages', pattern: '**/*.{tsx,ts,jsx,js,mdx}' },
  { framework: 'astro', dir: 'src/pages', pattern: '**/*.{astro,md,mdx}' },
  { framework: 'nuxt', dir: 'pages', pattern: '**/*.vue' },
  { framework: 'sveltekit', dir: 'src/routes', pattern: '**/+page.{svelte,ts,js}' },
] as const

/**
 * The URL path a route file serves.
 *
 * Returns undefined for anything that is not a page: a Next.js route group
 * `(marketing)` contributes no segment, a private folder `_lib` contributes no
 * route at all, and a dynamic segment `[slug]` cannot be resolved to one path
 * without knowing the data behind it.
 */
export function routePathFor(
  relativeFile: string,
  framework: RouteMap['framework'],
): string | undefined {
  const posix = relativeFile.split(path.sep).join('/')
  let route = posix

  if (framework === 'next-app' || framework === 'sveltekit') {
    // The whole filename when it is at the root — app/page.tsx is the site's
    // index, and a regex anchored on a slash never matches it.
    route = route.includes('/') ? route.replace(/\/[^/]+$/, '') : ''
  } else {
    route = route.replace(/\.[^./]+$/, '') // drop the extension
    route = route.replace(/\/index$/, '')
    if (route === 'index') route = ''
  }

  const segments = route.split('/').filter((segment) => segment !== '')
  const kept: string[] = []
  for (const segment of segments) {
    // A dynamic segment serves many paths; mapping it to one would be a guess.
    if (/^[[(]|^_|^@/.test(segment)) {
      if (/^\(.*\)$/.test(segment)) continue // route group: no segment of its own
      return undefined
    }
    kept.push(segment)
  }
  return kept.join('/')
}

/** Every page path a build could have emitted for one route. */
function emittedPathsFor(route: string): string[] {
  if (route === '') return ['/', 'index.html', 'index.htm']
  return [route, `${route}/`, `${route}.html`, `${route}/index.html`]
}

/**
 * Build a page-to-source map by reading the project's route files.
 *
 * Returns undefined when the project uses no convention this understands, which
 * is not a failure — most builds are not framework projects.
 */
export async function buildRouteMap(cwd: string): Promise<RouteMap | undefined> {
  for (const convention of CONVENTIONS) {
    const directory = path.join(cwd, convention.dir)
    try {
      if (!(await stat(directory)).isDirectory()) continue
    } catch {
      continue
    }

    const files = await glob([convention.pattern], {
      cwd: directory,
      ignore: ['**/node_modules/**'],
      onlyFiles: true,
    })
    if (files.length === 0) continue

    const sources = new Map<string, string>()
    for (const file of files) {
      const route = routePathFor(file, convention.framework)
      if (route === undefined) continue
      const source = `${convention.dir}/${file.split(path.sep).join('/')}`
      for (const emitted of emittedPathsFor(route)) {
        // First writer wins, so a more specific convention is not overwritten
        // by a looser one matching the same page.
        if (!sources.has(emitted)) sources.set(emitted, source)
      }
    }
    if (sources.size > 0) return { framework: convention.framework, sources }
  }
  return undefined
}

/** The source file for an audited page, if the map knows one. */
export function sourceFor(map: RouteMap | undefined, pagePath: string): string | undefined {
  if (map === undefined) return undefined
  return map.sources.get(pagePath) ?? map.sources.get(pagePath.replace(/^\//, ''))
}
