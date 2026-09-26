# Roadmap

What is planned, and why, newest release first. This is intent rather than a promise: there
are no dates, and anything here can be cut once it turns out to be wrong — one item below
was, and the reasoning is kept rather than the item. What does not change is the rule the
tool is built on: it reports what it found, and it says what it never looked at. Nothing
here is allowed to make a run look more complete than it was.

A section for a released version is left in place with what landed marked on it, so the
record shows what was planned as well as what shipped.

## Towards 1.0

1.0 is the release where somebody who has never read this file can install the tool, answer
a few questions, and end up with an audit in CI and a statement they can publish, without
having to learn the tool first. These releases get there:

- **0.8.0 — reach.** More of the EU single market, and the loop between editing and seeing
  a result made short enough to use while working rather than after.
- **0.9.0 — the first ten minutes.** Everything a new user meets before their first useful
  result: `init` that sets up CI and a baseline as well as a config, errors that say what to
  type next, a German rendering for Belgium's third language community, and Sweden,
  Denmark, Finland and Czechia.
- **0.9.1 — the corrected statements.** The Danish, Czech and Portuguese fixes from the
  citation check, and `pnpm release:check`, so a tag can no longer point at a commit with
  the wrong version.
- **0.10.0 — it finds your site.** Stack detection for what people actually build with
  (Next.js properly first), monorepos and package managers, and `eaa-kit detect` and
  `eaa-kit doctor` to explain what it found.
- **0.11.0 — it fits your workflow.** GitLab and Bitbucket CI from `init`, a Markdown
  summary for job summaries and PR comments, and an HTML report that prints, speaks the
  site's language and shows what changed since last time.
- **1.0.0 — the promise, kept.** A public `audit()` API, the contracts frozen under semver,
  and "everything works" shown by tests that run the tool the way its users do, on every
  platform, against real projects and hostile input. See
  [1.0.0](#100--the-promise-kept) for the plan.

Known before 1.0: on 1 January 2027, supervision under the Swedish Act moves from Post- och
telestyrelsen to Digitaliseringsmyndigheten (förordning 2026:1769, 21 §). The Swedish
templates have to change on that date, not before, because until then PTS is right. See
[docs/citations.md](docs/citations.md#sweden-se).

## 1.0.0 — the promise, kept

1.0 is the release somebody can install without reading anything, point at whatever they
build their site with, and get a correct audit, a CI job and a statement they can publish.
It is also the release where "it works" stops being a claim and becomes a set of checks
anyone can re-run.

The earlier outline said 1.0 would add no new surface, only 0.9 with the guarantees
written down. That turned out to be too narrow for a finished product, and the plan below
adds surface where a user would otherwise hit a wall:
- stack detection that covers what people actually use, Next.js above all, because a tool
  that cannot find the site cannot audit it;
- CI beyond GitHub;
- a report a client can read in their own language;
- an API to build on.

It adds nothing else. Everything is in place before the contracts are frozen, so nothing
arrives after the freeze.

### What 1.0 looks like to the person using it

It is built for freelancers and small agencies in the EU, who have had to comply since 28
June 2025 without an accessibility budget. It does five jobs for them: **find** the
barriers, **keep** them from coming back in CI, **prove** what a person checked by hand,
**publish** the statement their country's law asks for, and **show** a client the result in
a report a non-developer can read.

- **The first five minutes.**
  - `npx eaa-kit` with nothing set up detects the stack, builds or starts the site if it
    needs to, audits it and writes `.eaa-kit/report.html`. It ends with three lines: what it
    found, what it could not check, and the one command to run next.
  - `npx eaa-kit init` asks at most five questions, each with a default read from the site.
    It writes the config, a baseline, and a CI workflow for GitHub, GitLab or Bitbucket,
    whichever the repository is on. After that, every push is checked.
- **A small, stable set of commands**, one per job:

  | Job | Commands |
  | --- | --- |
  | First run | `eaa-kit` |
  | Set up | `init` |
  | Find | `audit` |
  | Explain | `detect`, new |
  | Keep | `baseline`, `diff` |
  | Prove | `checklist` |
  | Publish | `statement`, `countries` |
  | Diagnose | `doctor`, new: Node, Playwright, config, detection and CI file on one screen |

  Every command has examples in `--help`, and every failure ends with the command to type
  next. The exit codes mean the same everywhere: 0 clean, 1 barriers found, 2 could not run.
- **What it hands back.**
  - The HTML report is the product's face, the one file a freelancer sends a client. At 1.0
    it also:
    - prints cleanly, and can be saved as a PDF;
    - is written in the site's language, starting with de, fr, nl, es and it;
    - has a "since last time" section when there is a baseline or an earlier report;
    - is itself accessible, which CI checks by auditing it.
  - For CI: SARIF, and a new Markdown summary for job summaries and PR comments that says
    only what this change did.
  - The statement for fifteen countries, with authorities that switch on the date the law
    says.
  - For anyone building on it: a JSON report with a published schema, and a typed
    `audit()` and `detect()` library API. The build integrations become thin callers of
    that API.

The rest of this section is how that gets built and shown to work.

### How the work is done: loops with exit conditions

Every item below runs as a loop, not a to-do list. The rule is that a change is not done
when it compiles. It is done when the check that describes it is green, and that check
exists before the change does.

- **The inner loop, for every change.** Write the check that fails first: a test, a
  fixture or a benchmark budget. Make the change, then run `pnpm lint`, `pnpm typecheck`,
  `pnpm test` and the item's own gate. Repeat until everything is green. Never widen the
  change to get green.
- **The middle loop, for each item.** Each item names its gate (the fixture set, matrix or
  benchmark that proves it) and its exit condition. An item closes when its gate is green
  on Linux, macOS and Windows, not when the code is written.
- **The outer loop, for the release.** A nightly soak workflow runs the heavy gates that
  are too slow for a PR: real projects built from scratch, the hostile-input suite, the
  large-site benchmarks. Release candidates (`1.0.0-rc.N` on the npm `next` tag) go
  through the full gate. Every finding is fixed and ships as the next rc. **Exit:** one rc
  passes the full gate on all three platforms, followed by seven consecutive nightly soaks
  with no new finding. That rc, unchanged except for the version, becomes 1.0.0.
- **Who drives the loop.** The nightly results land as workflow artifacts and a summary
  comment. A scheduled check-in reads them, triages every red result into a fix or an
  issue, and re-arms. Nothing red is left unexplained for more than one cycle.

### 1. Stack detection that covers what people build with

Today the registry (`src/audit/frameworks.ts`) knows 21 frameworks by a package or a file,
and finds HTML in a fixed set of directories. That is enough for a single-app repository
using a mainstream static generator, and not much beyond it.

**1a. Next.js, in depth.** It is the most common stack this tool will meet, and the one it
handles worst: only a static export (`out/`) is found directly.
- Read `output` from `next.config.*`:
  - `'export'` means the output directory (`out/` or `distDir`) is audited as files;
  - `'standalone'` means the server is started with `node .next/standalone/server.js`.
- A normal `next build` writes prerendered HTML into `.next/server/app` and
  `.next/server/pages`. Those pages link to `/_next/static/…`, which does not exist at that
  path on disk, so auditing the files directly would audit pages without their CSS and
  report wrong contrast results. The plan is to **start `next start` and use the build
  manifests as the page list**: `prerender-manifest.json` and `routes-manifest.json`
  replace link discovery, so every prerendered route is audited even when nothing links to
  it. Dynamic routes that were not prerendered are reported as not audited, with the
  reason, rather than guessed at.
- Respect `basePath`, `trailingSlash` and `i18n` locales when crawling.
- Never audit `next dev`: the dev overlay and unoptimised output are not the site.
- Recognise Next-based documentation frameworks (Nextra, Fumadocs) as Next.js.
- Verify every manifest and path claim against real projects built with Next 14, 15 and
  the current major before it is relied on. Manifest formats change between majors, so each
  supported major gets its own fixture.

**1b. The frameworks that are missing.** Each one is added with its detection signal,
output directory, dev/preview port and anything to skip:
- **App frameworks:**
  - Angular 17+ writes to `dist/<project>/browser`, and `index.csr.html` must be skipped;
  - Qwik, SolidStart, Analog and TanStack Start;
  - Vue CLI, Parcel, Rsbuild and Rspack;
  - Ember.
- **Documentation and static generators:**
  - Hexo (`public/`), MkDocs (`site/`), Sphinx (`_build/html`), Zola (`public/`);
  - Pelican (`output/`), mdBook (`book/`), Quarto (`_site/`);
  - Docsify, which has no build step: its `index.html` is the site;
  - Hugo configured through `config/_default/` or `hugo.toml`.
- **Server-rendered systems**, detected and never started uninvited, as today: Drupal,
  Statamic, Ghost and Shopify themes.
- **Recognised in order to be excluded:** Storybook output (`storybook-static/`) is a
  component catalogue, not the site, and today it would be audited as if it were.

**1c. Monorepos.** Run from a repository root, the tool currently sees only the root
`package.json`.
- Detect pnpm, yarn and npm workspaces, Turborepo, Nx and Lerna.
- Enumerate the workspace packages that are sites:
  - exactly one: audit it;
  - several: list them with the command for each (`eaa-kit audit apps/web`), and have
    `init` ask which one.
- The generated CI workflow already supports `working-directory` and uses it.

**1d. Package managers.**
- The `packageManager` field (corepack) decides first, then lockfiles.
- Lockfiles include Bun's text `bun.lock` (Bun 1.2+) as well as `bun.lockb`, and Deno's
  `deno.lock` with `deno.json` tasks.
- Yarn Plug'n'Play is recognised, so no `node_modules` is not taken to mean nothing is
  installed.

**1e. Starting servers reliably.**
- Per-framework default ports, adding the ones missing today: Angular 4200, Gatsby 8000,
  Hugo 1313, Jekyll 4000, Django and Laravel 8000.
- Parse the URL the server announces through ANSI colour codes, `0.0.0.0`, `127.0.0.1`,
  IPv6 and Vite's `Local:` line.
- Wait for a real `200` from the page, not just any response.
- Report a port already taken by something else, instead of auditing the wrong server.

**1f. Single-page-app shells.**
- `200.html`, `index.csr.html` and Nuxt's SPA fallback are empty shells with one root
  element. Today they are audited as pages and pass, which is a false clean result.
- Recognise them and list them in completeness as "not audited: SPA shell, audit with
  `--url`". This follows the rule the tool is built on: say what was never looked at.

**1g. `eaa-kit detect`.**
- Prints what was recognised and the evidence for it (which package, file or config
  line), the output directory chosen, and what an audit would build or start. `--json`
  prints the same as data.
- Detection becomes debuggable by users and testable by the suite. The `detect()` library
  function returns the same result.

**Gate:**
- An offline fixture per framework and major version in `tests/fixtures/stacks/`: the file
  layout and config of a real scaffolded project, without `node_modules`. It runs on every
  PR and asserts what `detect` concludes.
- A nightly job that scaffolds each framework with its official `create-*` tool at a pinned
  version, installs, builds, and runs a real audit.
- The framework table in the docs is generated from the registry, and a test fails if they
  drift.

**Exit:** every registry entry has an offline fixture and a green nightly real build, on
all three platforms.

### 2. The contracts, frozen

After 1.0 these change only with a major version:
- the CLI: commands, flags, exit codes and the machine-readable outputs;
- the config file schema;
- the JSON report (`schemaVersion` 2), the baseline (2) and the review record (1);
- SARIF 2.1.0 with this tool's properties;
- the GitHub Action's inputs;
- the library exports and the integration option types.

The page cache is explicitly **not** a contract.
- **Published JSON Schemas** for the report, baseline, review record and config ship in the
  package under `schemas/`. The tests validate every example, snapshot and fixture against
  them, so the documentation and the code cannot disagree.
- **Surface locks:**
  - a committed snapshot of the public `.d.ts` API;
  - a committed snapshot of `--help` for every command.
  CI fails when either changes without a CHANGELOG entry, so nothing breaks silently.
- **What counts as breaking**, written down in `docs/contracts.md`. The subtle case is
  axe-core: a minor axe-core update can add a rule, which adds findings, which can fail
  somebody's CI. The policy: new rules arrive in minor releases, and a baseline absorbs
  them. Upgrades are pinned, and the changelog names the new rules.
- **A migration note from 0.x**, covering every flag or field that moved on the way.
- **The deprecated schemaVersion-1 field** in the JSON report stays until 2.0, documented as
  deprecated. Removing it now would mean a schemaVersion 3 on day one of the freeze.

**Exit:** schemas published and enforced, locks in CI, `docs/contracts.md` and the
migration note written.

### 3. Everything works, shown the way users run it

- **Acceptance matrix.** Every command (bare `eaa-kit`, `init`, `audit` on a directory,
  a URL and auto-detect, `baseline`, `checklist`, `statement`, `diff`, `countries`, `watch`
  and `detect`) is run against real fixture projects:
  - through each install method: `npx`, `pnpm dlx`, `bunx`, a global install and a local
    dev dependency;
  - on Linux, macOS and Windows.
  This extends `scripts/test-packaged.mjs`, which already runs the packed tarball.
- **Documentation that is executed.** Every shell command in the README and `docs/` is
  extracted and run against a fixture. A documented command that stops working fails CI.
- **Every error has a next step.** A test walks every exit-2 path and asserts it carries a
  `next` command. It also asserts that no path prints a stack trace, unless `--debug` asks
  for one.
- **Every integration runs in a real project** at the current major version of its host:
  Vite, Astro, Nuxt, Eleventy, webpack and the GitHub Action.
- **Every statement renders.** All fifteen countries in every language:
  - produce valid HTML;
  - leave no placeholder unfilled;
  - render identically with and without an audit report attached, apart from the findings
    section.

**Exit:** the matrix is green on all three platforms, and every documented command runs.

### 4. What could break it, tried on purpose

A `tests/robustness/` suite. Every case asserts the same things:
- a defined exit code;
- a message that says what happened and what to do;
- no stack trace;
- no orphaned process;
- no half-written file.

The cases:
- **Hostile files:**
  - malformed HTML, a 10 MB page, 50,000 nodes, nesting 1,000 deep;
  - pages in Shift-JIS or Latin-1, with and without a charset declaration, and with a BOM;
  - empty files, and binary files named `.html`;
  - symlink loops, and names with spaces, `#`, `%` and non-Latin characters;
  - 10,000-page builds, Windows long paths, and names that collide on case-insensitive
    filesystems.
- **Hostile networks:**
  - redirect loops, and servers that send bytes slowly enough to hit every timeout;
  - bursts of 5xx errors, connection resets, oversized responses and compression bombs;
  - a sitemap with 50,000 URLs, and a sitemap index that loops;
  - `429` with `Retry-After`, and credentials that expire mid-crawl;
  - an IPv6-only localhost, `HTTPS_PROXY`, and self-signed TLS (refused, with the flag
    that allows it named);
  - a port already in use.
- **Damaged state:**
  - truncated or corrupt cache, baseline, review record and config files;
  - two runs sharing one cache at the same time (writes must be atomic);
  - a read-only project (the cache is switched off with a notice);
  - a disk that fills during the report write.
- **Interrupted processes:**
  - Ctrl-C during the build, the server start and the audit. The test sends `SIGINT` and
    asserts the port is free and no child survives.
  - `watch` through 1,000 saves, with memory flat.
- **Environments:**
  - no TTY, the `CI` variable, `NO_COLOR`, `FORCE_COLOR` and 40-column terminals;
  - a non-English system locale, and a non-UTC time zone;
  - the exact Node floor in `engines`;
  - Playwright absent, or at the wrong version;
  - Alpine and musl in Docker, no git, and offline.
- **Generated input.** Property-based tests (fast-check) for the schema parser, URL
  normalisation and baseline matching. A longer fuzz run is part of the nightly soak.

**Exit:** every case is green on all three platforms, and a fuzz run finds nothing new for
seven nights.

### 5. Speed, measured the whole way through

Where it stands, from `pnpm bench` on 26 September 2026. These were measured on one
machine (4 cores, Node 22), so compare checkouts, not machines:

| | today |
| --- | --- |
| `eaa-kit --version` | 253 ms |
| audit, 1 page | 1,444 ms |
| audit, 20 pages | 3,854 ms |
| each further page | 127 ms |
| everything before the first page | 1,317 ms |
| 20 pages, nothing changed (cache) | 343 ms |

- **Benchmark what is not measured yet:**
  - crawl mode against a local 100-page server, and browser mode through Playwright;
  - static builds of 1,000 and 10,000 pages;
  - peak memory;
  - watch-mode latency from a save to the report;
  - `init`, `detect` and a first run from scratch.
- **`pnpm bench --against <ref>`.** It builds another checkout in a worktree and runs both,
  interleaved, on the same machine, then prints the difference. That is the only
  comparison that means anything, and it is how every speed claim in the changelog will be
  made.
- **Targets, relative to 0.9.0 on the same machine:**
  - no measurement slower by more than 10%;
  - everything before the first page cut by a third, by loading jsdom and axe-core only
    once a page is about to be audited, and loading only the report renderer that was
    asked for;
  - a 10,000-page audit that finishes, with peak memory flat rather than growing with the
    page count (no DOM retained after its page is reported);
  - nothing quadratic in de-duplication, baselines or reports.
- **The loop:** measure, profile with `--cpu-prof`, change one thing, re-measure, and keep
  the change only if it is a win with the tests green.
- **Nightly**, the soak job benchmarks against the last release tag on the same runner and
  posts the table. A slowdown of more than 20% is triaged. It is still not a PR gate, for
  the reason `scripts/bench.mjs` gives: timing on a shared runner is noise.

**Exit:** the targets are met, and the numbers in `docs/audit.md` are regenerated from
`--against v0.9.x`.

### 6. Releasing without surprises

- **`pnpm release:check`** verifies that:
  - the version in `package.json` matches the tag;
  - the CHANGELOG entry is dated;
  - the action pins in the docs and workflows match the version;
  - `examples/` is regenerated.

  It runs on release PRs and again in `release.yml` before publishing. This is the check
  that would have caught 0.8.0.
- **Publishing:** npm provenance on every publish, a test of the tarball's contents and
  size, and release candidates on the `next` tag.
- **Clean-up:**
  - delete the stray `v0.8.0` tag;
  - fix the `github-advanced-security` check, which fails on GitHub's side and needs the
    repository's code-scanning settings changed;
  - make `npm audit` clean;
  - add a `SECURITY.md`.

### 7. What must be right on release day

- **0.9.1 first.** The corrected Danish, Czech and Portuguese templates ship now, not with
  1.0.
- **Sweden, independent of the release date.** The Swedish authority becomes date-aware: a
  statement generated before 1 January 2027 names PTS, and one generated on or after it
  names Digitaliseringsmyndigheten (förordning 2026:1769, 21 §). A test with a fixed clock
  covers both sides. After that, it does not matter which side of New Year 1.0 lands on.
- **All fifteen countries in `docs/citations.md`.** The original seven (AT, CH, DE, ES, FR,
  IT, NL) have never had their check recorded there. They get the same treatment, and all
  fifteen are re-checked within 30 days of the tag.
- **Native-speaker review** of the Czech, Danish, Finnish, Swedish, Polish and Portuguese
  texts. This needs people, not the tool, so it is marked as a decision below.

### Not in 1.0

- **New countries.** Fifteen is the scope. The next ones come after 1.0, on a stable
  contract.
- **Writing fixes into source files.** Closed in 0.7.0, and still closed.
- **A score, Level AAA, anything model-generated, a hosted dashboard.** As before, and not
  later.

### Order of work

Each step is its own release, usable on its own, never a half-done step.

1. **0.9.1:** the corrected templates, and `release:check` from section 6.
2. **0.10.0:**
   - stack detection from section 1, Next.js first, then monorepos and package managers,
     then the missing frameworks;
   - `detect` and `doctor`;
   - the per-framework fixtures, and the nightly real-project job.
3. **0.11.0:**
   - GitLab and Bitbucket workflows from `init`, and the `markdown` report format;
   - the HTML report's print layout, languages and "since last time";
   - Sweden's date switch, and the citations for all fifteen countries.
4. **1.0.0-rc.N:**
   - the `audit()` and `detect()` API, with the integrations moved onto it;
   - the contract inventory and surface locks;
   - the acceptance and robustness harnesses;
   - the speed work measured against 0.9.x;
   - the README rewritten around the five jobs;
   - the reviews.
5. **1.0.0:** the release-candidate loop and the soak, until the exit condition holds.

### Done means

- Every gate in sections 1–6 is green on Linux, macOS and Windows.
- One release candidate passes the full gate, followed by seven clean nightly soaks.
- The contracts are documented and locked, with a migration note from 0.x.
- `docs/citations.md` covers all fifteen countries and was re-checked within 30 days of
  the tag.
- The speed targets are met, and the published numbers were regenerated with `--against`.

### Decisions, taken with the plan on 26 September 2026

1. **`detect` and `doctor` are the new commands.** They are the only new commands in 1.0:
   `detect` makes detection explainable and testable, and `doctor` puts the environment on
   one screen.
2. **GitLab and Bitbucket workflows come from `init`**, next to GitHub's. Many EU agencies
   are not on GitHub.
3. **The HTML report speaks the site's language**, starting with de, fr, nl, es and it.
4. **A public `audit()` API ships in 1.0.** Adding it after the freeze would take a 2.0.
5. **Native-speaker review blocks the release** for Czech, Danish, Finnish and Swedish (the
   texts written for 0.9.0). It is advisory for the rest.
6. **The GitHub Action gets a moving `v1` tag from 1.0.0.** Until now it was pinned to
   exact tags on purpose, because 0.x promised nothing; under semver, a `v1` tag is the
   convention.
7. **The deprecated schemaVersion-1 field** in the JSON report stays until 2.0.

## 0.9.0 — the first ten minutes

0.8.0 made the first command do the useful thing. 0.9.0 is about the next few: the ones a
new user runs after the first report, and what they read when one of those goes wrong.

### 1. `init` sets up the project, not only the config

A config file is one of three things a project needs before the tool is doing its job. The
other two are a baseline, so CI fails on new barriers rather than on every existing one,
and the CI job itself. `init` now offers both after writing the config:

- **A baseline**, when there is a built site to record it from. `init` never runs a build
  to get one. Recording it says how many barriers it accepts, the config's `audit` block
  points at it so a local `eaa-kit audit` reads it too, and the accepted barriers are still
  reported on every run, as they always have been.
- **A GitHub Actions workflow** at `.github/workflows/accessibility.yml`, when the project
  is in a git repository. It is written for this project: the package manager from the
  lockfile, the build script if there is one, the build directory `init` found, the
  baseline if one was just recorded, and the action pinned to this exact release.

The refusals: an existing workflow file is never overwritten. Nothing is set up that was
not offered. `--no-ci` and `--no-baseline` answer for a script. With `--yes` the defaults
apply, which means a workflow only inside a git repository and a baseline only when a
build is already there.

### 2. Errors say what to type next

Every exit-2 path a new user is likely to hit ends with the command that fixes it:

- No config: `eaa-kit init`.
- No template in that language: `--lang` with the languages the country has.
- An unknown country: `eaa-kit countries`.
- A missing or outdated report, baseline or review record: the command that writes one.
- A mistyped flag: the command's `--help`.

The rule is the one `start` already follows. An error that the reader cannot act on
without opening the docs is half an error.

### 3. Belgium in German, and four more countries: Sweden, Denmark, Finland, Czechia

| | Statute | Supervision named | Languages |
| --- | --- | --- | --- |
| `BE` | as 0.8.0 | as 0.8.0, in German | `de` added |
| `CZ` | Zákon č. 424/2023 Sb., o požadavcích na přístupnost některých výrobků a služeb | Česká obchodní inspekce (ČOI) | `cs`, `en` |
| `DK` | Lov nr. 801 af 7. juni 2022 om tilgængelighedskrav for produkter og tjenester | Sikkerhedsstyrelsen for e-commerce; supervision is split | `da`, `en` |
| `FI` | Laki digitaalisten palvelujen tarjoamisesta (306/2019), as amended for the Directive | Traficom | `fi`, `en` |
| `SE` | Lag (2023:254) om vissa produkters och tjänsters tillgänglighet | Post- och telestyrelsen (PTS) | `sv`, `en` |

**Written from secondary sources, like 0.8.0's four.** The official gazettes are still not
reachable from where this work is done, and the decision was to go ahead rather than wait.
All five are marked unverified in the registry, in `eaa-kit countries` and in the docs.
Their citations are kept to the statute and the supervisor, with no article numbers and
no fines, for the same reason as 0.8.0's. Nine countries' citations now need checking
against the primary text before the release that carries them is tagged.

Finland's Swedish rendering is not in this release. Swedish is an official language there
and the law exists in Swedish, but a Finnish statement in Swedish is a document of its
own, and it waits for a source text.

### 4. Redirects and sign-in walls, found before the crawl

Two things put a crawl somewhere other than where it was sent. Before this release, one
was found too late and the other only by guessing.

- **A redirect to another site.** `https://www.gtainside.de` answers with a 301 to
  `https://www.gtainside.com`. The crawl refused every page as "redirected off" and ended
  on an error that did not say what to do. Now the entry is followed one redirect at a
  time before the crawl, and a redirect to another site stops the run with where it went
  and the two commands that go on: audit the destination, or `--redirects follow`. In a
  terminal the default, `ask`, puts the question instead. A redirect within the same site
  (`www.`, http to https) is followed without a question. Every redirect the run followed
  is written into all four report formats, because a reader who asked for one site and
  is reading about another has to find that out before the first finding.
- **A sign-in wall.** A 401 or 403, a redirect to an identity provider, a redirect to a
  page that is a sign-in page by name, or a redirect to a page with a password field
  stops the run with exit 2 and the credentials flag to use. Before, the run audited the
  login form and reported it as the site. The weaker signal found during the crawl, many
  pages landing on one address, is now called a sign-in page when that page has a
  password field, and "looks like one" otherwise.

The refusals: a redirect to another site is never followed without a flag or a yes. The
destination passes the same `--allow-remote` gate as the entry. Credentials are only sent
while the redirect chain stays on the entry's origin. A redirect the run did not follow
produces no report, because a report about the wrong site is the failure being
prevented.

### Done means

- `lint`, `typecheck`, `test` (with colour forced as well as without), `smoke` and the
  packaged-CLI run green across the CI matrix.
- ~~The citation check for 0.8.0's four countries and this release's five, recorded in the
  changelog, before either version is tagged.~~ **Changed at release:** 0.8.0 was never
  published, and 0.9.0 shipped both with the check still open, the unverified marker on,
  and the changelog saying so. The citations were cross-checked against search excerpts
  from the official sites, which agree with all of them. The full check against the
  primary text is now a 1.0 blocker.
  **Done after release, on 25 September 2026:** all eight countries checked against the
  official text of each law, recorded in [docs/citations.md](docs/citations.md). It
  corrected Denmark (consumer banking is Sikkerhedsstyrelsen's, not Finanstilsynet's),
  Czechia (ČOI's remit stated too broadly) and Portugal (the INR's role), and the unverified
  marker is gone.

## 0.8.0 — reach

0.7.0 made a run cost what it should. 0.8.0 spends that on two things: getting the tool to
more of the people the EAA applies to, and getting a result to them while they are still
looking at the code that caused it.

### 1. Four more countries: Belgium, Ireland, Poland, Portugal

On 0.5.0's rule: a statement is written under its country's own law, not translated from
another's, in the language that law is administered in plus English.

| | Statute | Supervision named | Languages |
| --- | --- | --- | --- |
| `BE` | Loi du 5 novembre 2023 / wet van 5 november 2023, amending the Code de droit économique | SPF Économie, Direction générale de l'Inspection économique | `fr`, `nl`, `en` |
| `IE` | European Union (Accessibility Requirements of Products and Services) Regulations 2023 (S.I. No. 636 of 2023) | CCPC for e-commerce, ComReg and the Central Bank for their sectors | `en` |
| `PL` | Ustawa z dnia 26 kwietnia 2024 r. o zapewnianiu spełniania wymagań dostępności niektórych produktów i usług przez podmioty gospodarcze (Dz.U. 2024 poz. 731) | Prezes Zarządu PFRON, who receives every report; the minister for digital affairs supervises e-commerce | `pl`, `en` |
| `PT` | Decreto-Lei n.º 82/2022, de 6 de dezembro | ANACOM for e-commerce; supervisors report to INR | `pt`, `en` |

Belgium is the case the roadmap has been waiting for. Supervision is split, and the
templates say so rather than naming one body as if it owned the subject. Belgium also has
three official languages. The German-speaking community gets its rendering in 0.9: the
federal law is published in French and Dutch, and a German document written without a
German source text would be exactly the translation this rule forbids.

**What this release could not do, written down rather than hidden:** the session that wrote
these templates could not reach the official gazettes (irishstatutebook.ie,
isap.sejm.gov.pl, dre.pt, ejustice.just.fgov.be). Every citation above is corroborated by
several independent secondary sources: regulators' own pages, law firms and government
portals, as indexed. Each one still has to be checked against the primary text before 0.8.0
is tagged. That check is a release blocker, listed under *Done means* below. The templates
also cite less than the older seven do: no article numbers and no fine amounts, because
those are the details a secondary source gets wrong.

### 2. One place a country is defined

A country today is spread across `COUNTRIES`, `STATEMENT_LOCALES`, `init`'s locale table,
the date formats, the docs table and the snapshot list. Adding four more at once would mean
changing all of them eleven times over. The facts move into one registry (name, languages,
statute, authority, default site locale) that everything else reads from. A test fails when
a template exists without its registry entry, or the other way round.

### 3. `eaa-kit countries`

What the statement can be written for, from the terminal: code, name, languages, statute
and the authority each template names. Today that information lives in a docs table, so
nobody finds out that `--country PT` exists until they have read the docs.

### 4. `audit --watch`

[Deferred from 0.7.0](#not-in-070). A run over an unchanged build costs about as much as
starting the process, so it is worth repeating on every save. `--watch` re-audits the
build directory whenever something in it changes. The page cache means only the changed
pages are audited again, and the report is printed again after each run.

The refusals:

- **Directories only.** A running site under `--url` changes without writing anything this
  process can watch, so a watch over it would be a poll that looks like a watch. It is an
  error, not a quiet fallback.
- **No exit code on the way.** A watch never exits 1 because a run found something. Its
  job is to show the result, and CI has the one-shot run for failing a build.
- **A run is never skipped because another one is in progress.** A change that arrives
  mid-run starts a new run as soon as the current one ends. A report never shows a build
  the files on disk have already moved past.

### 5. `init` stops guessing

`init` turns an unrecognised country into `AT` without saying so. That is an Austrian legal
document for somebody who typed `pl`. An answer it does not recognise is now asked again,
with the list, and the prompt names each country in full.

### 6. The first run needs no setup

`eaa-kit` on its own printed the help and exited 2, and that is the first command anybody
types. Now it is the whole first run. It finds the site the way `audit` already does,
audits it, writes the HTML report to `.eaa-kit/report.html`, and then says what it found
out about the project and which command comes next, depending on what the project already
has: `init` if there is no config, `baseline` if there are findings and no baseline.

Two gaps in the detection close with it. A folder of hand-written HTML with no
`package.json` is audited where it stands. `init` now reads what the built site states
about itself, `<html lang>` and its canonical address, and offers those as defaults. It
still only offers what the site states outright: a language tag suggests a country, it
does not decide one, and `init` still asks.

The refusals: the first run writes nothing into the project outside `.eaa-kit/`, and gives
that directory a `.gitignore` of its own instead of editing the project's. A folder with no
site in it is left exactly as it was found. The first run also keeps `audit`'s exit codes.
Exiting 0 on a site with critical barriers, because this happened to be somebody's first
look, would tell them it was clean.

### Not in 0.8.0

- **Belgium in German, and the Nordic and Czech statements.** 0.9, for the reason above.
- **Watching a running site.** See the refusal above.
- **A score, Level AAA, anything model-generated, a hosted dashboard.** As before, and not
  later.

### Done means

- `lint`, `typecheck`, `test`, `smoke` and the packaged-CLI run green across the CI matrix.
- **Every citation in the four new countries' templates checked against the primary
  text**, and the checking recorded in the changelog: who checked it, against which
  consolidated version. Until then 0.8.0 is not tagged. (0.8.0 was not published; it
  shipped as part of 0.9.0, with the check still open. See 0.9.0's *Done means*.)
- `examples/` regenerated and drift-checked.
- A changelog entry saying what was given up as well as what was added.

## 0.7.0 — the run that costs nothing, and the loop that closes

0.6.0 added the half no engine can do. 0.7.0 is about three things a user feels: how long a
run takes, whether the compliance loop closes, and whether the numbers this project quotes
can be re-run by anybody.

The measurement that set the agenda: a page costs about 80 ms to audit, and everything
before the first page costs about 900 ms, nearly all of it loading jsdom. So a run over a
site where nothing changed pays a second to be told nothing changed, and CI re-audits two
hundred pages for a commit that touched three.

### 1. Auditing only what changed — landed

Built as [0.6.0's item 3](#3-auditing-only-what-changed) specified it, including every
refusal: reuse is its own count and never part of `audited`, all four formats say how much
was reused and from when, `diff` will not call a reused page fixed, any input that could
change a verdict discards the whole cache, and `--no-cache` forces the full run.

One thing the item did not anticipate and the code now does: pages are collected and hashed
before anything decides an engine is needed, so a run that reuses all of them never imports
jsdom. Twenty pages, cold to fully reused: ~2,520 ms to ~230 ms, against ~165 ms for
`eaa-kit --version`.

### 2. `pnpm bench` — landed

Every performance claim in this repository was a number in a doc comment produced by a
benchmark that no longer existed — `pool.ts`'s thresholds are still calibrated to a 4-core
box that lives only in a commit message. `scripts/bench.mjs` measures the fixed cost, the
marginal cost of a page, cached against cold, and the four renderers, and prints a table two
checkouts can be compared on. Not a CI gate: timing on a shared runner is noise.

### 3. The statement cites the manual review — landed

0.6.0 stopped one step short — `statement --review` read the record only to refuse a claim
that contradicted it. The document now says how many of the 55 criteria a person checked and
when, in all fourteen templates, and never says what the review concluded: that is a claim,
and the place for a claim is the barrier list somebody writes themselves.

### 4. Writing fixes into source files — not viable, and here is the verdict

[Deferred from 0.6.0](#not-in-060) with three preconditions: an opt-in, a dry run, and a
much stronger story about mis-attribution. Investigated properly for this release, and the
answer is that it must not be built. The preconditions were the wrong ones — they are about
consent, and the problem is that there is nothing correct to write:

- **The remediation table is not a fix table.** Of 24 entries, 7 carry an `example`
  transform and none produces a complete, correct fix. `image-alt` emits
  `alt="What this image shows"`; `link-name` emits `>Where this link goes<`; `html-has-lang`
  emits a hardcoded `lang="de"` whatever the page's language; `meta-viewport` overwrites the
  whole `content` attribute, destroying a legitimate `viewport-fit=cover`. Applying these
  turns a report green while the barrier stands, which is the failure this whole tool is
  written against.
- **The source mapper locates a literal, not an element.** `componentFor` returns where a
  *string* was found, with no proof it sits inside markup, no element boundaries and no end
  offset. Its input is axe-core's serialised DOM, truncated at 300 characters with attribute
  values elided at 20 — enough to say "open this file", impossible as the basis for a
  byte-level edit.
- **The emitted HTML is not the source dialect.** Writing `<img … alt="…">` into a `.tsx`
  file is a build break; into `.vue`, `.svelte`, `.astro`, `.twig` or `.php` it can land
  inside a binding, a script block or a template expression.

What would have to exist first: a remediation table whose entries are correct without a
human, and element-precise source ranges. Neither is close, and neither is worth building
for this. The item is closed rather than deferred again.

### 5. Maintenance — landed

- Node 26 in the CI matrix, which `engines` has claimed since 0.6.0.
- A test that fails when axe-core's rule set moves. It found the drift it was written for on
  the day it was added: the published figure "axe-core has rules touching 23 of 55" was two
  too high, because two of those criteria — Orientation and Label in Name — are covered only
  by rules axe-core tags experimental, which this tool does not run. The real number is 21,
  and the README, both docs pages and the module comment now say so.

### Not in 0.7.0

- **The four countries (BE, PL, PT, IE).** Unchanged from 0.6.0 and unchanged in reason:
  each needs its statute, supervisory body and enforcement route from primary sources, and
  that is the work. A fabricated citation in a published legal document is the worst failure
  this tool could have.
- **A watch mode.** The natural payoff of the cache — a run that costs 230 ms is a run worth
  repeating on save — but it holds a process open and brings its own failure modes. 0.8.
- **A score, Level AAA, anything model-generated, a hosted dashboard.** As before, and not
  later.

## 0.6.0 — the part a machine cannot do, and the code that does the rest

Every release since 0.2 added surface: more countries, more flags, more build systems, a
second engine. 0.5.0 finished that arc — seven countries, defaults in the config file, and
`--fast`. 0.6.0 spends most of its effort on two things that are not surface.

The first is the honest gap this tool has counted since 0.3 and done nothing about. Of the
55 WCAG 2.2 A and AA success criteria, 34 have no automated rule at all. Every report says
so. Saying so is where it stops: there is no way to record that somebody checked them, so
the 34 look identical in the report of a site nobody has reviewed and a site that was
audited by hand last week.

The second is the code. `src` is 11,775 lines across 51 files, `tests` another 11,390. None
of it is bad and most of it is well explained, but it grew a release at a time, and it
shows: `report/console.ts` (714 lines) and `report/html.ts` (822) pull in the same ten
helpers and render the same six sections in two idioms, `report/json.ts` and
`report/sarif.ts` are 319 and 312 lines over the same findings, and the five build
integrations are five wrappers around one 119-line function. Adding the manual-review
record below means touching all four report formats. Doing that to the code as it stands
means writing the same change four times, so the compaction comes first.

### 1. `ponytail` — compaction as a standing practice

`ponytail` is a skill, checked in at [`.claude/skills/ponytail/SKILL.md`](.claude/skills/ponytail/SKILL.md),
that makes code smaller and better without changing what it does. It folds duplication,
removes indirection with a single caller, unifies parallel implementations of one idea, and
deletes surface nothing uses. It is deliberately not a formatter and not a code-golf pass:
it compacts the *shape* of the code, never the reading of it.

What it must never do matters more than what it does, so it is written down in the skill and
enforced in review:

- **Doc comments stay.** The prose in this codebase explains why a refusal exists — why a
  skipped rule never becomes a pass, why the browser runner places results by position. That
  is the most valuable text in the repository. Compaction removes code, never the reasons.
- **Output does not move.** `examples/` holds generated output for every format. A
  compaction pass that changes one byte of it has changed behaviour and is wrong until
  proven otherwise.
- **No behaviour change rides along.** A commit either compacts or changes what the tool
  does. Never both.

Applied to the code that exists, in one pass per area, in this order — each one is a
separate commit and reports the lines it removed:

1. `src/audit/report/` — one shared model of a rendered report, four presentations of it.
2. `src/cli/` — the option plumbing repeated across five commands.
3. `src/audit/` runners, `crawl`, `routes`, `collect` — the page-set logic that arrived in
   three separate releases.
4. The five build integrations, which already share `integration/run.ts` and should share
   more.
5. `tests/` — same rules, applied last, because the suites are what proves the other four
   passes were safe.

`src/statement/templates/` is explicitly out of scope, now and later. Those 1,795 lines of
near-parallel Markdown are near-parallel on purpose: each is a document under its own
country's law rather than a translation of another's, and factoring the shared sentences
out of them would re-introduce exactly the coupling 0.4.0 and 0.5.0 removed.

Applied to code that does not exist yet: `ponytail` runs on a branch before its PR is
opened, so new code arrives compacted rather than getting a cleanup release later. That is
the whole point of it being a checked-in skill instead of a one-off refactor — the pass
below ends, the practice does not.

**Landed:** the skill, the drift check, and the first pass over `src/audit/report/` — where
the tally three formats each recomputed became the one the JSON report builds, and the rule
catalogue JSON and SARIF each walked became one function. The renderers lost 37 lines and
the shared modules gained 58, most of it comments; the number that moved was not the line
count but how many places compute a figure three reports print.

Two supporting tasks land with it, because compaction without a tripwire is a guess:

- **An examples drift check in CI.** `pnpm examples` followed by `git diff --exit-code
  examples/`. The files are already generated and already committed; nothing currently fails
  when they stop matching the code.
- **A size ledger.** `src` and `tests` line counts reported in each release's changelog
  entry, so the direction is visible rather than asserted.

### 2. Recording what a person checked

A new `eaa-kit checklist` command, and a record it reads and writes.

It generates the manual review as two files from one source: a Markdown checklist for the
person doing the work, and `eaa-review.json` as the record. It covers the 34 criteria with
no automated rule, plus the rules the browserless engine cannot decide, which is material
`src/audit/manual.ts` already carries and currently only prints.

The record then feeds the rest of the tool:

- `audit` merges it, so a criterion reads *checked by whom, when, with what result* instead
  of *not evaluated*. The `--coverage` view gains the distinction it is missing: reached by
  this engine, reached by a person, reached by nobody.
- `statement` fills its conformance section from it, so the claim in a legal document cites
  a review that happened rather than being typed into a config file by hand.

And the refusals, which are the part that decides whether this is worth shipping at all:

- A record can never turn an automated failure into a pass. It adds evidence about criteria
  the engine could not reach; it does not overrule the engine on criteria it did.
- A review that has aged out is reported as such, with its date, rather than silently
  counted.
- An unreviewed criterion stays unreviewed. Generating the checklist is not doing the check,
  and no output will imply otherwise.
- Unfilled entries in the record are not "in progress" — they are absent from the coverage
  view exactly as they are today.

**Landed**, as `eaa-kit checklist`, `eaa-review.json`, and `audit --review` /
`--review-max-age`, with all four refusals asserted. Two things are narrower than the
paragraph above promised, and are written down in
[docs/review.md](docs/review.md#what-it-does-not-reach-yet) rather than left to be
discovered:

- **Staleness is by the calendar, not by the pages.** `--review-max-age <days>` ages a
  record; matching a review against the pages it covers would need the run to fingerprint
  what it audited *and* the record to have recorded it, which is the page cache's problem
  below and belongs with it. An undated entry does not count once a maximum age is asked
  for, which is the honest reading of "cannot be shown to still hold".
- **The statement does not read the record.** Its conformance claim still comes from the
  config file. Putting a review into a legal document is the same class of work as adding a
  country and gets the same care; it is not done in 0.6.0.

### 3. Auditing only what changed

**Landed in 0.7.0**, as written.

CI audits the whole build on every push, and most pushes change three pages. A content-hash
cache under `.eaa-kit/` lets a run reuse the result for a page whose HTML is byte-identical
to the last run's.

The saving is obvious and so is the risk: a reused result is a result this run did not
produce, and a report that hides that is the exact failure this tool exists to refuse
elsewhere. So the completeness record gains reuse as a category, every report format says
how many pages were reused and from when, `diff` refuses to call a reused page fixed, and
`--no-cache` forces the full run. A cache miss on any input that could change a verdict —
axe-core version, engine, rule set, flags — invalidates the whole cache rather than the
page.

### 4. The next countries

Belgium, Poland, Portugal and Ireland, on the rule 0.5.0 set: a statement is written under
its country's own law, not translated from another's, and the language matrix stays sparse —
the language the law is administered in, plus English, and a request for anything else is an
error that names what the country does have.

Belgium is the interesting one and the reason it is first: three language communities and
supervision that genuinely is split, which is the case that breaks any template pretending
one authority owns the subject. Ireland brings no new language but a distinct transposition
route. For each, the statute, the supervisory body and the enforcement route are established
from primary sources before a line of template is written — every citation in the existing
seven was, and a wrong one in a document somebody publishes is worse than not shipping the
country.

### 5. Baselines that expire

**Corrected after reading the code**: most of this already shipped. Entries carry
`acceptedOn`, `--expires-on` sets a date after which an entry suppresses nothing, expired
entries are announced, and entries the run no longer matches are already reported as
removable — with the care not to say that about pages a narrowed run never audited.

What was actually missing was smaller than the item claimed: a `baseline --prune` that
rewrites the file without the entries the current build no longer produces, so acting on
that advice is not a hand edit. **Landed**, keeping the two things it must not touch —
entries for pages the run did not audit, and expired entries, which are decisions with
dates rather than barriers that went away.

### 6. Maintenance

**The first two landed in 0.7.0.**

- axe-core within 4.x, and a test that fails when its rule set moves, because the WCAG
  coverage claim is computed from that set and is a claim about facts.
- Node 26 in the CI matrix.
- Dependency and toolchain bumps.

### Not in 0.6.0

- **Writing fixes into source files.** `remediation` prints the corrected form of your
  markup; editing somebody's components is a different level of trust and needs an opt-in,
  a dry run and a much stronger story about mis-attribution. Revisit for 0.7.
  **Revisited, and closed**: see [the 0.7.0 verdict](#4-writing-fixes-into-source-files--not-viable-and-here-is-the-verdict).
- **A score, a percentage or a grade.** Not in 0.6.0 and not later. Most of WCAG cannot be
  automated, and a number would present that as a fact about a site.
- **Level AAA.**
- **Anything generated by a model.** The remediation advice is deterministic and offline so
  that it cannot invent a fix that looks right. That does not change.
- **A hosted dashboard or an account.** This is a command that runs in your build.

### Order of work

1. ~~`ponytail` and the examples drift check~~ — done; everything after it is smaller for it.
2. ~~The `report/` compaction pass~~ — done, before checklist added fields to all four formats.
3. ~~`checklist` and the review record~~ — done, with the two narrowings noted above.
4. ~~The page cache~~ — done in 0.7.0, and it carries the fingerprinting a content-based
   staleness check would need.
5. The four countries — independent of the rest, and can land at any point. Each needs its
   statute and supervisory body established from primary sources first, which is the work,
   not the template.
6. ~~`baseline --prune`~~ — done. Then maintenance and release.

### Done means

- `lint`, `typecheck`, `test`, `smoke` and the packaged-CLI run green across the CI matrix.
- `examples/` regenerated, reviewed as output rather than as a diff, and drift-checked in CI.
- Schema versions moved only where a field changed meaning, and the changelog saying which
  and why — new fields alone do not move them.
- A changelog entry that says what was given up as well as what was added, which is the
  convention the 0.5.0 entry set for `--fast`.
- The `src` and `tests` line counts, reported rather than claimed.
