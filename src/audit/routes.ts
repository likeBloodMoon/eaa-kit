import path from 'node:path'
import { glob } from 'tinyglobby'
import { isDirectory, toPosix } from '../fs.ts'
import { detectFramework } from './frameworks.ts'
import { type PackageJson, readPackageJson } from './project.ts'

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
 *
 * Two things decide which convention applies. The registry says what the
 * project is, because a directory name does not: `src/pages` belongs to Next,
 * Astro, Gatsby and Vue alike, and probing for it in declaration order labelled
 * a Gatsby project `next-pages`. Where the registry knows nothing, the
 * directories are probed as before — most builds are not framework projects,
 * and a map is better than no map.
 */

/** Routers this understands well enough to name a file from a page. */
export type RouteFramework =
  | 'next-app'
  | 'next-pages'
  | 'nuxt'
  | 'astro'
  | 'sveltekit'
  | 'remix'
  | 'gatsby'
  | 'starlight'
  | 'vitepress'
  | 'docusaurus'
  | 'hugo'

export interface RouteMap {
  /** Framework the map came from, for the report to name. */
  framework: RouteFramework
  /** Audited page path (POSIX, relative to the build) to source file. */
  sources: Map<string, string>
}

/**
 * Where a routing convention lives and how to read it.
 *
 * `toRoute` rather than one function branching on the framework: the routers
 * agree on almost nothing. Remix delimits segments with dots, Hugo names a
 * section index `_index.md`, SvelteKit puts the route in the directory and the
 * kind in the filename. Sharing one function across those meant a chain of
 * special cases that nobody could read; each convention now states its own rule
 * and the simple ones share a default.
 */
interface Convention {
  framework: RouteFramework
  /**
   * Registry ids this convention belongs to, so detection can choose between
   * two conventions claiming the same directory.
   */
  ids: readonly string[]
  dir: string
  pattern: string
  toRoute: (relativeFile: string) => string | undefined
}

/**
 * A path segment that serves more than one page, or none.
 *
 * Dynamic segments are refused rather than resolved: `[slug]` stands for every
 * post there is, and picking one would name a file that did not produce the
 * page in front of the reader. Private and slot folders contribute no route at
 * all.
 */
function classifyBracketSegment(segment: string): 'route' | 'skip' | 'refuse' {
  if (/^\(.*\)$/.test(segment)) return 'skip' // route group: organisational only
  if (/^[[(]|^_|^@/.test(segment)) return 'refuse'
  return 'route'
}

/** Drop the extension, and fold an index file into the directory it sits in. */
function withoutExtension(file: string): string {
  const route = file.replace(/\.[^./]+$/, '').replace(/\/index$/, '')
  return route === 'index' ? '' : route
}

/** The directory a route file sits in, for routers that put the route there. */
function containingDirectory(file: string): string {
  return file.includes('/') ? file.replace(/\/[^/]+$/, '') : ''
}

/** Keep the segments that are routes, refusing the file if any is dynamic. */
function joinSegments(route: string): string | undefined {
  const kept: string[] = []
  for (const segment of route.split('/').filter((part) => part !== '')) {
    const kind = classifyBracketSegment(segment)
    if (kind === 'refuse') return undefined
    if (kind === 'skip') continue
    kept.push(segment)
  }
  return kept.join('/')
}

/** `pages/kontakt.tsx` serves `/kontakt`; the filename is the route. */
function fileNamedRoute(file: string): string | undefined {
  return joinSegments(withoutExtension(file))
}

/** `app/kontakt/page.tsx` serves `/kontakt`; the directory is the route. */
function directoryNamedRoute(file: string): string | undefined {
  return joinSegments(containingDirectory(file))
}

/**
 * A documentation tree whose directory layout is the URL layout.
 *
 * No dynamic segments to worry about — these are files an author wrote, one per
 * page — so the only work is folding the index file into its directory.
 */
function mirroredRoute(file: string): string | undefined {
  return withoutExtension(file)
}

/**
 * Remix and React Router flat routes: `blog.post.tsx` serves `/blog/post`.
 *
 * The dot is the separator, `_index` is a directory's own page, and a trailing
 * underscore on a segment escapes a parent layout without changing the URL. A
 * `$` segment is dynamic and refused, as `[slug]` is elsewhere.
 */
function remixRoute(file: string): string | undefined {
  // Both layouts: `blog.post.tsx`, and `blog.post/route.tsx` for a folder.
  const withoutRouteFile = file.replace(/\/route\.[^./]+$/, '')
  const flat = withoutRouteFile === file ? withoutExtension(file) : toPosix(withoutRouteFile)

  // A nested directory is not part of the URL in flat routes; only dots are.
  const leaf = flat.includes('/') ? (flat.split('/').pop() as string) : flat
  if (leaf === '') return undefined

  const kept: string[] = []
  for (const raw of leaf.split('.')) {
    // `blog_` opts out of the parent layout and contributes `blog` regardless.
    const segment = raw.replace(/_$/, '')
    if (segment === '') continue
    if (segment === '_index') continue // the directory's own page
    // `$` alone is a splat, `$slug` a parameter; both serve many paths.
    if (segment.startsWith('$')) return undefined
    // `sitemap[.]xml` escapes a literal dot; not a page worth mapping.
    if (segment.includes('[')) return undefined
    kept.push(segment)
  }
  return kept.join('/')
}

/**
 * Hugo content: `content/posts/hello.md` serves `/posts/hello/`.
 *
 * `_index.md` is a section's own page rather than a page called `_index`, which
 * is the one place Hugo's leading underscore does not mean "private".
 */
function hugoRoute(file: string): string | undefined {
  const withoutIndex = file.replace(/(^|\/)_index\.[^./]+$/, '')
  if (withoutIndex !== file) return toPosix(withoutIndex)
  return withoutExtension(file)
}

/**
 * Conventions, most specific first.
 *
 * Order still matters where the registry knows nothing about a project, which
 * is the case for a plain directory of HTML and for anything the registry has
 * not heard of.
 */
const CONVENTIONS: readonly Convention[] = [
  {
    framework: 'next-app',
    ids: ['next'],
    dir: 'app',
    pattern: '**/page.{tsx,ts,jsx,js,mdx}',
    toRoute: directoryNamedRoute,
  },
  {
    framework: 'next-app',
    ids: ['next'],
    dir: 'src/app',
    pattern: '**/page.{tsx,ts,jsx,js,mdx}',
    toRoute: directoryNamedRoute,
  },
  {
    framework: 'remix',
    ids: ['remix'],
    dir: 'app/routes',
    pattern: '**/*.{tsx,ts,jsx,js,mdx}',
    toRoute: remixRoute,
  },
  {
    framework: 'starlight',
    ids: ['astro'],
    dir: 'src/content/docs',
    pattern: '**/*.{md,mdx,mdoc}',
    toRoute: mirroredRoute,
  },
  {
    framework: 'astro',
    ids: ['astro'],
    dir: 'src/pages',
    pattern: '**/*.{astro,md,mdx,html}',
    toRoute: fileNamedRoute,
  },
  {
    framework: 'gatsby',
    ids: ['gatsby'],
    dir: 'src/pages',
    pattern: '**/*.{tsx,ts,jsx,js,md,mdx}',
    toRoute: fileNamedRoute,
  },
  {
    framework: 'next-pages',
    ids: ['next'],
    dir: 'pages',
    pattern: '**/*.{tsx,ts,jsx,js,mdx}',
    toRoute: fileNamedRoute,
  },
  {
    framework: 'next-pages',
    ids: ['next'],
    dir: 'src/pages',
    pattern: '**/*.{tsx,ts,jsx,js,mdx}',
    toRoute: fileNamedRoute,
  },
  {
    framework: 'nuxt',
    ids: ['nuxt'],
    dir: 'pages',
    pattern: '**/*.vue',
    toRoute: fileNamedRoute,
  },
  {
    framework: 'sveltekit',
    ids: ['sveltekit'],
    dir: 'src/routes',
    pattern: '**/+page.{svelte,ts,js}',
    toRoute: directoryNamedRoute,
  },
  {
    framework: 'docusaurus',
    ids: ['docusaurus'],
    dir: 'docs',
    pattern: '**/*.{md,mdx}',
    // Served under /docs by default. A project that moved routeBasePath gets no
    // map rather than a wrong one; see docsRouteBase below.
    toRoute: (file) => {
      const route = mirroredRoute(file)
      return route === undefined ? undefined : route === '' ? 'docs' : `docs/${route}`
    },
  },
  {
    framework: 'vitepress',
    ids: ['vitepress'],
    dir: 'docs',
    pattern: '**/*.md',
    toRoute: mirroredRoute,
  },
  {
    framework: 'hugo',
    ids: ['hugo'],
    dir: 'content',
    pattern: '**/*.{md,html}',
    toRoute: hugoRoute,
  },
]

/**
 * The URL path a route file serves.
 *
 * Returns undefined for anything that is not a page: a Next.js route group
 * `(marketing)` contributes no segment, a private folder `_lib` contributes no
 * route at all, and a dynamic segment `[slug]` cannot be resolved to one path
 * without knowing the data behind it.
 */
export function routePathFor(relativeFile: string, framework: RouteFramework): string | undefined {
  const convention = CONVENTIONS.find((candidate) => candidate.framework === framework)
  if (convention === undefined) return undefined
  return convention.toRoute(toPosix(relativeFile))
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
export async function buildRouteMap(cwd: string, pkg?: PackageJson): Promise<RouteMap | undefined> {
  for (const convention of await orderedConventions(cwd, pkg)) {
    const map = await mapConvention(cwd, convention)
    if (map !== undefined) return map
  }
  return undefined
}

/**
 * Conventions to try, the detected framework's first.
 *
 * Without this, `src/pages` is claimed by whichever convention is declared
 * earliest, so a Gatsby project was reported as `next-pages`. The mapping
 * happened to be right and the name was wrong, which is the kind of detail a
 * reader notices and stops trusting the rest of the report over.
 */
async function orderedConventions(cwd: string, pkg?: PackageJson): Promise<Convention[]> {
  // Read it here when the caller had no reason to: several of these frameworks
  // are identified by a dependency and nothing else, so without package.json
  // the registry cannot tell Gatsby from Next and the ordering it exists to fix
  // does not happen.
  const detected = await detectFramework(cwd, pkg ?? (await readPackageJson(cwd)))
  if (detected === undefined) return [...CONVENTIONS]

  const id = detected.framework.id
  const mine = CONVENTIONS.filter((convention) => convention.ids.includes(id))
  const rest = CONVENTIONS.filter((convention) => !convention.ids.includes(id))
  return [...mine, ...rest]
}

/** Read one convention's directory, or undefined when it has nothing to say. */
async function mapConvention(cwd: string, convention: Convention): Promise<RouteMap | undefined> {
  const directory = path.join(cwd, convention.dir)
  if (!(await isDirectory(directory))) return undefined

  const files = await glob([convention.pattern], {
    cwd: directory,
    ignore: ['**/node_modules/**'],
    onlyFiles: true,
  })
  if (files.length === 0) return undefined

  const sources = new Map<string, string>()
  for (const file of files) {
    const route = convention.toRoute(toPosix(file))
    if (route === undefined) continue
    const source = `${convention.dir}/${toPosix(file)}`
    for (const emitted of emittedPathsFor(route)) {
      // First writer wins, so a more specific convention is not overwritten
      // by a looser one matching the same page.
      if (!sources.has(emitted)) sources.set(emitted, source)
    }
  }
  if (sources.size === 0) return undefined
  return { framework: convention.framework, sources }
}

/** The source file for an audited page, if the map knows one. */
export function sourceFor(map: RouteMap | undefined, pagePath: string): string | undefined {
  if (map === undefined) return undefined
  return map.sources.get(pagePath) ?? map.sources.get(pagePath.replace(/^\//, ''))
}
