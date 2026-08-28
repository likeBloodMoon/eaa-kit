# Changelog

Notable changes to eaa-kit. The format follows [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [semantic
versioning](https://semver.org/spec/v2.0.0.html).

Two contracts have version numbers of their own and are called out here whenever they
move: the JSON report's `schemaVersion` and the baseline file's. Both are bumped only when
a field is removed, renamed, or changes meaning — new fields may appear without one, so
consumers must ignore what they do not recognise.

## 0.1.1 — 2026-08-28

### Fixed

- `engines.node` was `>=22.22.2`, which promised support for the odd-numbered Node
  release lines. jsdom supports only the even-numbered ones, so installing on Node 23 or
  25 produced an `EBADENGINE` warning naming jsdom rather than eaa-kit. The range is now
  `^22.22.2 || ^24.15.0 || >=26.0.0`, matching what the dependency actually supports.

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
