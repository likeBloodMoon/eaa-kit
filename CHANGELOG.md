# Changelog

Notable changes to eaa-kit. The format follows [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [semantic
versioning](https://semver.org/spec/v2.0.0.html).

Two contracts have version numbers of their own and are called out here whenever they
move: the JSON report's `schemaVersion` and the baseline file's. Both are bumped only when
a field is removed, renamed, or changes meaning — new fields may appear without one, so
consumers must ignore what they do not recognise.

## 0.2.2 — 2026-08-28

### Fixed

- `--browser` also failed against a perfectly good install with *Playwright is installed
  but exports no chromium launcher*. Playwright is CommonJS, and whether `await import()`
  exposes its named exports depends on Node's static analysis of the file succeeding —
  which is not guaranteed and differs between versions. Where it does not, everything sits
  on `default`. Both shapes are read now, `@playwright/test` is accepted alongside
  `playwright` since it is what most projects install, and if something does resolve
  without a launcher the error names what was found instead of only that the tool is
  unhappy.

### Added

- Framework detection covers fourteen builders instead of two: Next.js, Nuxt, SvelteKit,
  React Router/Remix, Astro, Gatsby, Docusaurus, VitePress, Eleventy, Angular, Create
  React App, Hugo, Jekyll and Vite. Each knows where it writes browsable HTML, whether
  that takes extra configuration, and whether it can serve pages it never writes to disk
  — which is what decides whether `--url` is a real answer or a consolation.
- A custom output directory is read out of the framework's own config, so a Vite project
  with `outDir: 'www'` or an Astro one with `outDir: './built'` is found without being
  told. Read with a pattern rather than executed: a config file is code, and this runs
  before anything has decided the project is trustworthy.

### Changed

- The three lists that used to hold this knowledge — a flat array of output directories,
  a five-name dependency check, and the route conventions — are one registry. They
  disagreed, and none of them knew that `out/` belongs to Next.js and `_site/` to
  Eleventy.

- The HTML report leads with what to fix. A severity scoreboard, then the violations
  grouped by the element that causes them — with the source file where a router
  convention names one, and identical markup on three or more pages called out as likely
  one shared component. The page-by-page listing is still there, below.
- The scoreboard carries what could **not** be evaluated in the same row as the severity
  counts, at the same size. A row reading "0 critical, 0 serious" is the one place this
  document could mislead: on a real run that same result may mean six whole rule
  categories went unchecked, and a client reading only the top of the page would take it
  for a clean site.
- Every colour pair the new sections add was checked against the surface it sits on:
  seventeen pairs, worst 7.30:1, against the 4.5:1 that AA asks of text. Severity is
  still carried by the word as well as the colour.

## 0.2.1 — 2026-08-28

### Fixed

- `--browser` could not find Playwright when eaa-kit was run through `npx`, which is how
  most people run it. A bare `import('playwright')` resolves against this package's own
  location, and under npx that is a cache directory with no playwright in it — so somebody
  who had just installed Playwright into their project was told to install Playwright. It
  is now resolved from the audited project first, and only then from here.
- A browser that failed to launch left the loopback server listening, so the run hung
  instead of reporting the failure. The commonest way in is Playwright installed but
  `npx playwright install chromium` never run.
- Running the project's build printed Node's DEP0190 deprecation warning into the middle
  of the output. Windows needs a shell to run npm and pnpm, which are `.cmd` shims there,
  but passing an argument array alongside `shell: true` is what the deprecation is about;
  cmd.exe is now invoked explicitly with one command string.

## 0.2.0 — 2026-08-28

### Security

- `--url` re-checks the origin after every redirect. `parseEntryUrl` gates the entry point
  and the link and sitemap filters gate what is discovered, but a redirect was the one way
  out of the origin that neither of them saw: a loopback crawl redirected to an internal
  host or to the public internet followed it and audited what it found, which is precisely
  what `--allow-remote` exists to prevent. A page that lands off-origin is refused and
  reported as a failure, naming where it went.

### Breaking

- `eaa-kit audit` no longer defaults to `./dist`. With no directory and no `--url` it works
  the project out instead — see below. Naming a directory behaves exactly as before, and
  anything scripted as `eaa-kit audit ./dist` is unaffected.
- The console report leads with **Issues** and no longer prints the page-by-page listing
  unless `--per-page` is passed. Anything parsing that listing out of stdout needs the
  flag. The other three formats are unchanged.

### Added

- `eaa-kit audit --url http://localhost:3000` audits a running site instead of a build
  directory. Until now the tool read HTML off disk, which covers every static builder and
  none of the sites that render on a server and never write a file — Next.js without a
  static export, Nuxt, SvelteKit, Remix, anything behind a CMS. Those projects could only
  be audited by first producing an export, which many of them cannot.
- Pages are discovered from `sitemap.xml` when the site has one, and by following
  same-origin links either way — a sitemap listing three of forty pages should not stop
  the crawl at three. `--max-pages` (default 200) and `--max-depth` (default 3) bound it.
- `eaa-kit baseline --url …` records a baseline from a running site, so a served site can
  adopt the tool the same way a static one does.
- Crawling is loopback-only unless `--allow-remote` is passed, and `robots.txt` is
  honoured unless `--ignore-robots` is. A tool that fails builds should not be one flag
  away from crawling production, or somebody else's site, out of CI.
- A URL that could not be fetched is named and counted, never silently skipped: a crawl
  that quietly dropped half a site would report the other half as though it were whole.
- `--browser` works with `--url`, navigating Chromium at the real URL rather than serving
  a copy of the markup back from disk.

- `eaa-kit audit` with no arguments works out what to audit. It looks for a build
  directory that exists and holds HTML; failing that it runs the project's own build and
  looks again; and failing that — a site that renders on a server and emits no browsable
  HTML at all — it starts the project's server, crawls it, and stops it again. `--no-build`
  turns all of it off, and naming a directory or passing `--url` skips it.
  `./dist` is no longer the default, because it was only ever right for some projects and
  silently wrong for the rest.

- An **Issues** section groups violations by the element that causes them, across the
  whole site. On a site built from components one broken header reappears on every page
  that renders it, and a page-by-page report never says those seven findings are one line
  in one file. This one does: *9 violations across the site come from 3 distinct
  elements*, worst first, then by how far each reaches. Identical markup on three or more
  pages is called out as likely one shared component.
- Findings name the source file that produced the page — `index.html  app/page.tsx` —
  derived from the router's own conventions rather than a build manifest, so it does not
  depend on framework internals. Next.js app and pages routers, Nuxt, Astro and
  SvelteKit. A dynamic route serves many paths, so it is left unmapped rather than
  guessed at; a wrong file is worse than none.

- `eaa-kit init` writes an `eaa.config.json`. `audit` needed no arguments; `statement`
  still needed a config file whose schema you had to go and read first, which made
  "install it and run it" true of one half of the tool and false of the other. It asks
  only for what it cannot know, takes the site name and URL from `package.json`, and
  refuses to overwrite a config that is already there. What it writes is
  `partially-compliant`, never `compliant`: it is written before any audit has run.

### Removed

- zod, which was 6.4 MB of a 37 MB install for three closed schemas — the config file,
  the JSON report and the baseline — each already wrapped in hand-written error messages.
  `src/schema.ts` does what those three need and no more: an install is now **31 MB**, and
  the call sites did not change. The one place that needed an input type distinct from the
  parsed one, `defineConfig`, writes it out rather than inferring it — it is the type
  people see while filling the file in, so it is worth being readable.

### Changed

- The JSON report's `target` carries `source` (what was audited) and `kind`
  (`directory` or `url`). `directory` never holds a URL — under `--url` it is `null` — so
  a consumer written against `schemaVersion` 1 sees exactly what it always did. The
  version stays at 1 on that reasoning: crawls did not exist under 1, so no report shape
  that version could already produce has changed.
- The console report now leads with **Issues** and prints the page-by-page listing only
  under `--per-page`. The listing is the same information keyed the other way round, and
  on a fifty-page site it buries what somebody actually needs. On a seven-page fixture the
  default report is 49 lines against 107.
- The message for a build directory with no HTML in it now looks at what the project
  actually has, and says what to do about it: an `out/` that already exists, a Next.js
  config with no `output: 'export'` in it, an export configured but never built, a Nuxt
  project, or any other build directory lying around. Where a static export cannot work,
  it points at `--url` rather than leaving the reader with advice that cannot apply.
- A directory that does not exist gets the same guidance as one holding no HTML. They are
  the same mistake to whoever typed the path, and the missing-directory case — which is
  what somebody sees pointing the tool at `./dist` in a Next.js project — previously got
  only a generic pointer back at `./dist`.
- The audited target named in reports is now what was actually audited. A `--url` run
  recorded `./dist`, the directory default it never read.

## 0.1.1 — 2026-08-28

### Fixed

- `engines.node` was `>=22.22.2`, which promised support for the odd-numbered Node
  release lines. jsdom supports only the even-numbered ones, so installing on Node 23 or
  25 produced an `EBADENGINE` warning naming jsdom rather than eaa-kit. The range is now
  `^22.22.2 || ^24.15.0 || >=26.0.0`, matching what the dependency actually supports.
- `pnpm smoke` passed its glob patterns in single quotes, which `cmd.exe` does not treat
  as quotes, so on Windows the patterns arrived with the quotes attached and matched
  nothing. The Astro build test invoked the extensionless `node_modules/.bin/tsdown`,
  which `execFile` cannot run on Windows. Both are fixed, and CI now runs the whole suite
  on Windows and macOS as well as Linux rather than inferring cross-platform behaviour
  from reading the path handling. That job immediately caught two more test bugs: a
  `file:` URL's `pathname` was used as a filesystem path, which on Windows is
  percent-encoded and carries a leading slash before the drive letter, and the Astro
  build test spawned a `.CMD` shim that Node refuses to run without a shell. The library
  itself was correct in both cases — it uses `fileURLToPath` throughout.

### Changed

- A directory that exists but holds no HTML now says which directory to use instead, and
  names the static export when it finds a Next.js or Nuxt config. `./dist` is the default
  because most static builders emit it, and it is wrong for every framework that does not
  — the old message left the reader no way to tell those apart.
- `docs/audit.md` gained a section on which directory to point the tool at, and one on
  what memory a large site needs: jsdom's DOMs are not reclaimed as fast as the loop
  produces them, so peak memory follows the largest heap one thread holds. 800 pages runs
  out of a 1 GB heap under `--concurrency 1` and completes on the threaded default, since
  each worker is a separate isolate.

## 0.1.0 — 2026-08-28

First release. Everything below is new, so it is written as what the tool does rather than
as a list of changes to something that came before.

### Auditing

- `eaa-kit audit [dir]` globs the HTML out of a build directory, parses it with jsdom and
  runs axe-core against it. No browser download, and nothing is fetched or executed.
- Rules the browserless engine structurally cannot decide — colour contrast, target size,
  computed overflow — are reported as **not evaluated** with the reason, never as passing,
  whichever bucket axe-core put them in.
- axe-core's four result categories are kept apart everywhere. `passes` is the only one
  that is evidence of anything, and `inapplicable` is never added to it.
- `--browser` audits in real Chromium instead, over a loopback server so that root-
  absolute asset paths resolve and the site's own JavaScript runs. Playwright is an
  optional peer dependency; the default path never downloads a browser.
- `--fail-on <impact>` sets the lowest impact that fails the run. A violation axe-core did
  not classify counts at every threshold.
- Pages are audited across worker threads, chosen from the estimated work and the
  machine's core count. `--concurrency <n>` overrides it; `1` runs in one thread. Output
  is byte-identical either way.
- Exit codes: `0` clean, `1` violations at or above the threshold, `2` the run reached no
  verdict.

### Baselines

- `eaa-kit baseline [dir]` records the violations a build already has, and
  `eaa-kit audit --baseline <file>` fails only on the ones it does not list.
- An accepted violation is still reported, in every format, and never becomes a pass. A
  page whose violations were all accepted is reported as having no *new* violations.
- Matching is exact: same page, same rule, same element. Entries that no longer match are
  reported so the file shrinks; `--expires-on` makes an acceptance temporary.
- Baseline file `schemaVersion` 1.

### Statements

- `eaa-kit statement` writes a Barrierefreiheitserklärung from `eaa.config.{ts,mts,js,mjs,json}`.
- Austria, Switzerland and Germany, in German and English, as Markdown or HTML. Each
  country's template names its own statute and supervisory body; the Swiss one says the
  BehiG is not an EAA transposition and that Switzerland has no market surveillance
  authority for private websites, rather than inventing one.
- Covers the sections the EU model requires: conformance status, non-accessible content
  with a reason for each barrier, feedback mechanism, enforcement procedure, and the date
  it was prepared.
- `--audit <report>` lists the barriers a JSON report found. Their descriptions are
  axe-core's, in English, and each entry says so and asks to be rewritten.

### Reports

- `--format console | json | sarif | html`.
- JSON is a versioned public contract at `schemaVersion` 1. Deliberately excluded:
  absolute filesystem paths, per-page timings, and raw axe-core tags.
- SARIF 2.1.0 for GitHub code scanning, with fingerprints derived from the rule, selector
  and markup rather than the file path, so moving a page does not close one alert and open
  an identical one. Baselined violations are emitted as `suppressions`.
- HTML is one self-contained page with no assets and no scripts, for sending to whoever
  has to fix the site. It is audited by eaa-kit's own engine in the test suite.
- Output is deterministic apart from the timestamp, so two reports of the same build diff
  cleanly.

### Running it in a build

- An Astro integration at `eaa-kit/astro` audits the output in `astro:build:done` and
  fails the build. Astro is an optional peer dependency and is never imported at runtime.
- A composite GitHub Action builds, audits, uploads the SARIF log and then fails the job,
  in that order, so the alerts are in place even when the audit fails.

### Known limits

- Automated testing finds a minority of accessibility barriers. Nothing this tool produces
  is a compliance statement, and every document it writes says so in its own words.
- Content inside iframes is not audited, and a client-rendered page has little in its
  built HTML for the browserless engine to see. `--browser` closes the second gap.
