# Changelog

Notable changes to eaa-kit. The format follows [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [semantic
versioning](https://semver.org/spec/v2.0.0.html).

Two contracts have version numbers of their own and are called out here whenever they
move: the JSON report's `schemaVersion` and the baseline file's. Both are bumped only when
a field is removed, renamed, or changes meaning — new fields may appear without one, so
consumers must ignore what they do not recognise.

## 0.2.0 — 2026-08-28

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

### Changed

- The message for a build directory with no HTML in it now looks at what the project
  actually has, and says what to do about it: an `out/` that already exists, a Next.js
  config with no `output: 'export'` in it, an export configured but never built, a Nuxt
  project, or any other build directory lying around. Where a static export cannot work,
  it points at `--url` rather than leaving the reader with advice that cannot apply.
- A directory that does not exist gets the same guidance as one holding no HTML. They are
  the same mistake to whoever typed the path, and the missing-directory case — which is
  what somebody sees pointing the tool at `./dist` in a Next.js project — previously got
  only a generic pointer back at `./dist`.

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
