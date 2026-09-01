# Changelog

Notable changes to eaa-kit. The format follows [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [semantic
versioning](https://semver.org/spec/v2.0.0.html).

Two contracts have version numbers of their own and are called out here whenever they
move: the JSON report's `schemaVersion` and the baseline file's. Both are bumped only when
a field is removed, renamed, or changes meaning — new fields may appear without one, so
consumers must ignore what they do not recognise.

## 0.4.0 — 2026-09-01

### Added

- **What a run did not measure is now in the report.** A crawl that fetched twelve pages of
  a two-hundred-page site, or that failed forty URLs on the way, produced a report
  byte-identical to a complete one: the crawler had already counted the failures, the
  truncation and how the pages were found, and every one of those numbers was written to
  stderr and then dropped. The person who reads the report is usually not the person who
  watched it run, so the facts now reach all four formats — a `completeness` object in
  JSON, a section in the HTML report naming each page it could not reach and why, lines in
  the console summary, and `run.properties` in SARIF.

  The HTML report grows a fourth verdict for it. A clean result over part of a site is not
  the clean result it looks like, so it no longer gets the plain pass banner: it says that
  no violations were found *and* that the whole site was not measured, because the banner
  is the part that gets quoted. Exit codes are deliberately unchanged — an incomplete run
  is not a violation, and failing builds on it would break every pipeline already running
  this tool.

- **Four more build-time integrations**: `eaa-kit/eleventy`, `eaa-kit/docusaurus`,
  `eaa-kit/webpack` and `eaa-kit/nuxt`. Each is a thin adapter over the decision function the
  Astro integration and the Vite plugin already share, and each describes its host
  structurally, so none of them adds a dependency and installing eaa-kit in a project with no
  webpack still typechecks.

  Two earn their place by knowing something the Vite plugin cannot. The **Nuxt** module
  audits in `close` rather than when Vite finishes, because Nitro prerenders afterwards — a
  Vite hook would read the build before the pages it exists to audit had been written — and
  it refuses to pass a `nuxt build` that prerendered nothing rather than reporting success
  over an empty directory. The **webpack** plugin skips watch rebuilds, since auditing a
  whole site on every keystroke would make a dev server unusable, and skips a build that
  already failed, since reporting its missing pages as accessibility findings would send
  somebody after defects nothing measured.

  There is deliberately no Next.js plugin, and the docs now say why: Next has no hook that
  fires after `output: 'export'` writes `out/`, so a config wrapper would audit stale output
  or none. `next build && eaa-kit audit ./out` is the honest answer.

- **What to do about a finding, not just what is wrong with it.** axe-core says "images must
  have alternative text" and links to a page about the rule; neither is the fix, and the gap
  between a report and a corrected line of code is where an accessibility tool either earns
  its place in a build or becomes something people mute. Each finding now carries who the
  barrier stops, what to change, and the corrected form of the markup that actually failed —
  the user's own element, because a textbook snippet is a second thing to translate.

  Where the fix genuinely differs by framework it is given in that idiom: where `lang` lives
  in a Next.js, Nuxt, Astro, SvelteKit or Remix project is not the same question as which
  attribute is missing. Where it does not differ — which is most rules — the same advice is
  given whatever built the site, because emitting fourteen near-identical snippets would be
  churn pretending to be coverage. An overlay states only what changes and inherits the
  rest, so a framework-specific fix cannot silently lose the corrected snippet along with it.

  Deterministic and offline: no model, no API key, no network. This sits beside a document
  with legal weight, and a plausible fix that is wrong is a worse failure than no fix at
  all — somebody would paste it, the report would go green, and the barrier would still be
  there.

- **Findings name the line as well as the file.** `componentFor` already had to find the
  literal in the source to know which file contained it; recording where it found it costs
  one more scan of one string, and `src/components/Header.astro:12` opens an editor where
  `src/components/Header.astro` starts a search.

- **How much of WCAG a run actually reaches, with the standard as the denominator.** The
  tool refuses to divide passes by failures and is right to — only `passes` is evidence,
  and the two summed would make an empty page look compliant — but refusing that number
  left nothing in its place, so "automated testing finds a minority of barriers" stayed a
  sentence in the footer rather than a figure.

  WCAG 2.2 has 55 success criteria at Levels A and AA. axe-core has rules touching 23 of
  them. Every run now says so in a line, `--coverage` lists all 55 and what the run reached
  on each, and the HTML report always includes the table. Each criterion lands in exactly
  one of four outcomes — evaluated here, not evaluable by this engine, rules ran and found
  nothing to check, or no automated rule exists at all — which are never summed or divided
  into a score. The last is the majority, and it is the point: a percentage would present a
  limit of automated testing as though it were a measurement of the site.

  Falling out of the same table: the cost of the browserless engine, said as a number
  rather than as general advice. `MANUAL_CHECKS` already recorded per rule whether a real
  browser resolves it, and nothing read that field; the report now names how many more
  criteria `--browser` would answer.

- **Six more routers can name the source file behind a page.** Remix and React Router
  (including flat routes, where `blog.post.tsx` serves `/blog/post`), Gatsby, Docusaurus,
  VitePress, Starlight and Hugo join Next.js, Nuxt, Astro and SvelteKit. The registry
  already recognised fourteen builders; the report could name a source file for five of
  them, so everyone else got `leistungen.html` — which the route mapper's own comment calls
  "accurate and unhelpful".

  Angular, Eleventy and Jekyll are deliberately still unmapped, and the docs now say why:
  Angular's routes live in a TypeScript object rather than the filesystem, and Eleventy and
  Jekyll let a page set its own URL in front matter, so their file layout is not the route.
  Mapping the default convention alone would be right until somebody used the feature.

- **WordPress, TYPO3, Craft, Laravel, Symfony, Rails and Django are recognised.** They
  write no browsable HTML to disk, so an empty `./dist` is not a path to correct — there
  was never going to be anything in it. Rather than the generic "point me at your build
  directory", the tool now names the project, the command that gets it serving, and the
  `--url` line to run next. They are identified by a file rather than a dependency, because
  a `package.json` in one of these belongs to a theme's asset build and says nothing about
  the CMS around it — which is also why a WordPress theme bundled with Vite is reported as
  WordPress rather than as Vite.

  Detected and then left alone: `eaa-kit audit` with no arguments will run a static
  builder's own build and start its preview server, and for these it does neither. Starting
  one means spawning a stateful, usually container-backed stack that may touch a database,
  which is more than an accessibility audit was asked to do.

- **`eaa-kit diff <before.json> <after.json>`**, for the question a review actually asks and
  which neither report answers on its own: running the auditor on a branch prints everything
  wrong with the site, and the two or three findings somebody introduced are somewhere in
  the middle of it. Every violating element is sorted into new, fixed, unchanged, or *not
  compared*.

  That last bucket is the reason to trust the other three. A violation missing from the
  second run has two explanations — somebody fixed it, or nothing looked at that page — and
  reporting the second as fixed would turn a crawl that stopped early into a changelog of
  work nobody did. So a violation is called fixed only where the later run actually reached a
  verdict on its page. `--fail-on` judges new violations only; failing on what was already
  there would be an audit with extra steps.

  It is not a baseline and does not replace one. A baseline is a file somebody commits and
  maintains, answering *what have we agreed to live with*; a diff is stateless and answers
  *what did this change do*.

- **Every node in the JSON report carries its `fingerprint`** — the same identity the
  baseline records and SARIF sends, so a consumer comparing two reports need not reimplement
  the hash and risk disagreeing with the two tools that already depend on it agreeing.

- **`--sitemap`**, for the site's page list when it is not at `/sitemap.xml`. WordPress with
  Yoast serves `/sitemap_index.xml`; TYPO3 and Craft put it behind a route of their own, and
  link following alone then finds only what the navigation links to. A named sitemap is used
  instead of the default rather than as well as it, so a wrong path is a visible mistake
  rather than a silent fall back to a crawl that covers less.

### Fixed

- **The integrations could not be loaded from a CommonJS config**, which is the shape most
  of their hosts use. `webpack.config.js`, `docusaurus.config.js` and `.eleventy.js` are
  ordinarily CommonJS, and every subpath export named only an `import` condition — so the
  `require('eaa-kit/webpack')` line printed in the docs failed outright with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`. A documented integration that cannot be loaded as
  documented.

  Each subpath now names a `require` condition alongside `import`, pointing at the same
  file: Node's `require(esm)` loads it on every version this package supports, so nothing
  is compiled twice and the package stays ESM-only. The one thing that would break it again
  is a top-level `await` anywhere in a module graph an integration pulls in, so the packaged
  harness now loads all six entries with `require` as well as `import` — a future one fails
  there instead of in somebody's build.

- **The Nuxt module read a value that is undefined in every build.** It took the output
  directory from `nuxt.options.nitro.output.publicDir`, which Nuxt never populates — Nitro
  resolves it onto its own instance instead. The module would have refused every build,
  including a successful `nuxt generate`, with "there was nothing to audit". Its unit test
  agreed with the bug, because a hand-written stand-in only ever confirms what its author
  assumed. It is now driven by a real `nuxt generate` and a real `nuxt build`, as the Astro
  integration already was, and reads the directory from `nitro:init` where it actually
  lives. The timing claim the module rests on survived that check: at `build:done` the
  public directory does not exist, and by `close` it holds every prerendered page.

- **The Eleventy plugin audited on every watch rebuild.** `eleventy.after` fires on each
  save under `--watch` and `--serve`, so a dev server would have run a full site audit
  between keystrokes — the webpack plugin already guarded against exactly this and Eleventy
  did not. It now audits one-shot builds only, and skips the non-filesystem output modes
  (`--to=json` and friends), which write nothing to look at. A real `eleventy` build drives
  it in the tests; unlike the Nuxt module, its reading of the hook was correct to begin with.

- **A criterion with one unevaluable rule among several read as "nothing to check".** WCAG
  2.1.1 Keyboard is the only criterion whose rules are mixed: `scrollable-region-focusable`
  needs computed overflow, while `frame-focusable-content` and `server-side-image-map` are
  DOM-determinable. Requiring every rule to be blind before reporting a criterion as
  unevaluated meant a page with no frames and no image maps reported 2.1.1 as though the
  rules had run cleanly — while the same report's rule listing said
  `scrollable-region-focusable` had reached no verdict. One document contradicting itself
  about a Level A criterion, in the direction that understates the gap: the browserless
  engine's cost was reported one criterion lower than it is. A test now asserts the two
  views cannot disagree.

- **The bundled GitHub Action example pinned a version three releases old**, and the runnable
  copy of the workflow told readers to use a moving `@v0` tag that `docs/integrations.md`
  says on the same page does not and will not exist. The example and the documentation now
  agree.

- **A Gatsby project is no longer reported as Next.js.** Route conventions were matched by
  probing directories in declaration order, and `src/pages` belongs to Next.js, Astro,
  Gatsby and Vue alike, so whichever was declared first claimed it. The mapping was right
  and the name beside it was wrong. Which convention applies is now decided by what the
  registry says the project is, falling back to probing only where it recognises nothing.

- **One unreadable file no longer fails the whole collection.** A single bad permission bit
  in a build directory rejected every page with it, so the run reported as a crash rather
  than as the one page nobody could look at. The rest of the build is audited and the file
  is named in the report. The failure is only swallowed where a caller has undertaken to
  report it, so nothing goes missing silently.

### Changed

- The engine-blindness table moved from the jsdom runner to `result.ts`, beside the
  `BlindRule` type it instantiates. It is data about what an engine can see, not about the
  jsdom library, and a module reachable from the CLI's startup path could not read it where
  it was without pulling 630 ms of jsdom into `eaa-kit --help`. Both names are still
  exported from the runner, so nothing that imported them had to change.

- **Duplicated code folded into shared helpers**, with no change to any report, exit code
  or public export. Six modules had their own `try`/`stat`/`catch` for whether a path
  exists; the URL a page is audited under was written out three times, once with a comment
  asking that it be kept in step with the others; four sorters separately agreed by hand
  that an unclassified impact ranks with the most severe; the console and HTML reports each
  grouped the unevaluated rules and built the coverage line themselves; and `audit` and
  `baseline` each spelled out the same engine selection and the same setup-failure
  handling. The HTML report now reads the JSON report's tally rather than recomputing it,
  so the two cannot disagree about what a run found.
- **Rules the engine could not evaluate tie-break by rule id** in the console report's
  "Not evaluated" section when they appear on the same number of pages, rather than by the
  order they were encountered. Two runs of one site now order that section identically,
  which is the guarantee the rest of the reports already make.

### Removed

- Dead code: a Vite logger branch identical to its own `else`, two format type guards with
  no callers left, a flag parser that was another one duplicated verbatim, and the Astro
  integration's options interface, which restated the shared one field for field and is now
  an alias of it, so the Astro and Vite entries cannot drift apart.

## 0.3.0 — 2026-08-29

### Added

- **A Vite plugin**, `eaa-kit/vite`. One plugin rather than four: SvelteKit, Nuxt, Remix
  and Astro all build on Vite, so a plugin in the Vite config is a plugin in all of them.
  It audits in `closeBundle`, after the build has written its files, and fails the build on
  violations at or above the threshold.
- **The source file a failing element was written in**, not just the page that renders it.
  Route mapping names `app/page.tsx`; a header with a missing `alt` is written in none of
  the pages that show it. A literal from the failing markup — an image path, a link
  target, an id — is looked for in the project's own source, and the file is named only
  when exactly one contains it. Frameworks emit source positions only in development
  builds, and an auditor runs against production output; a literal survives every compiler.
- **What to check by hand.** Every rule the browserless engine cannot decide now carries
  the check a person would do, and every success criterion a link to its WCAG Understanding
  page. `--manual` prints the checks in the console report; the HTML report always
  includes them. Automated testing finds a minority of barriers, and this turns that
  disclaimer into the part of the report with the most work in it.

### Changed

- The Astro integration and the Vite plugin share one decision function. Both arrive at a
  finished build in a directory and have to decide whether it may proceed; only the hook
  name and the logger differed.

### Fixed

- **A browser that was never downloaded is reported as a step to run, not a crash.**
  `npm i -D playwright` does not fetch Chromium, so somebody who followed the install
  line exactly still landed here — and what they got was Playwright's advice boxed in
  ASCII, wrapped in a stack trace through eaa-kit's bundled internals, which reads as the
  tool falling over rather than as setup left to do. It is now four lines naming the
  command and the path the browser was looked for at, so a misdirected
  `PLAYWRIGHT_BROWSERS_PATH` is visible too. Launch failures that are not this are passed
  through untouched, because they are real faults and dressing them up as setup advice
  would send somebody off installing a browser they already have.

### Testing

- **Every subpath export is now imported from a real packaged install**, not merely checked
  for existence on disk. A file that ships and does not load fails inside somebody's build
  rather than in this repository, which is exactly how the browser-mode bugs of 0.2.x reached
  users.

- **The packaged CLI is now run the way an install runs it**, by `pnpm test:packaged` and
  on every CI job. Three browser-mode bugs reached users through this path in 0.2.1 and
  0.2.2, and none of them could have been caught here: the suite imports from `src/` and
  runs inside this repo, where Playwright sits next to the code. Nothing about that
  resembles the arrangement that broke. So the harness rebuilds the arrangement instead of
  describing it — a real `npm pack`, extracted somewhere that is not the project, with
  Playwright installed only in the project, which is what npx creates. It asserts the run
  finds a contrast violation, a rule the browserless engine cannot evaluate at all, so a
  silent fallback to jsdom fails the check rather than passing it quietly.

  Each of the three fixes was reverted in turn to confirm the harness goes red: the
  resolution fix reproduces *needs Playwright* against a project that has it, the export
  fix reproduces *no chromium launcher* against a working install, and removing the launch
  guard hangs the run until the harness times it out.

### Not done

- **There is no Next.js plugin, deliberately.** Next has no stable hook that runs after a
  build writes its files: `next.config.js`'s `webpack` function is the usual place, and
  Next 16 defaults to Turbopack, which does not call it — confirmed by running a build
  with a config that logs from there, and it never printed. A plugin built that way would
  look wired up and silently never run, which for an accessibility check is worse than
  having none. `next build && eaa-kit audit`, or plain `eaa-kit audit`, always work.

## 0.2.2 — 2026-08-29

### Added

- The GitHub Action takes `url`, `allow-remote` and `max-pages`, so a site that renders on
  a server can be audited from CI. `--url` shipped in 0.2.0 and the Action had no way to
  reach it, which left the feature's main audience — anyone auditing in a workflow rather
  than a terminal — unable to use it. Leaving both `url` and `directory` empty lets
  eaa-kit work the project out, as it does on the command line.

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

- `package.json` no longer describes this as a tool "for static sites". It has audited
  running ones since 0.2.0, and that string is what npm shows on the package page.
- The documentation matched the report as it was two versions ago: `docs/reports.md`
  described an HTML report organised by page, and `docs/audit.md` placed the issues
  section under a page listing that is now behind `--per-page`. `--per-page` and
  `eaa-kit init` were undocumented outside the README.
- `pnpm examples` holds the run timestamp still, so regenerating the checked-in examples
  produces a diff only when something actually changed. Every run used to rewrite the one
  field that varies on its own, which is how a real change hides in the noise.
- The example workflow points at `@v0` rather than `@v0.1.0`, which had been stale for
  four releases.

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
