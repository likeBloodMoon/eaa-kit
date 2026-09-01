# Auditing a build

`eaa-kit audit` globs the HTML out of a build directory and checks it against WCAG 2.2 AA
with axe-core. This page covers the command, both engines, and how to read what it returns.

```bash
eaa-kit audit                    # works out what to audit
eaa-kit audit ./dist             # or say so
```

## With no arguments

`eaa-kit audit` on its own works out what this project needs, in three steps:

1. **A build that already exists.** The first of `dist/`, `out/`, `build/`, `_site/`,
   `.output/public/` or `public/` that holds HTML. Holding HTML is the test, not merely
   existing — `.next/` exists after any Next.js build and holds no browsable page, and
   `public/` exists in most projects and holds assets.
2. **The project's own build.** Nothing built yet, so it runs the `build` script rather
   than telling you to go and do it and come back. The package manager comes from the
   lockfile.
3. **The project's server.** Built and still no HTML anywhere means the site renders on a
   server — a Next.js app with an API route, middleware or ISR, and anything else that
   cannot be exported. It starts `start`, `preview` or `serve`, crawls what that serves,
   and stops it again afterwards.

Naming a directory or passing `--url` skips all of it, and `--no-build` stops it running
anything, leaving step 1 only.

Steps two and three run your project's own scripts. That is what a build-time tool does —
the Astro integration already audits from inside a build — but it is announced as it
happens, and `--no-build` turns it off.

## Auditing a running site

```bash
eaa-kit audit --url http://localhost:3000
```

Fetches the pages instead of reading them, which is the only way to reach a site that
renders on a server and never writes HTML to disk — Next.js without a static export,
Nuxt, SvelteKit, Remix, anything behind a CMS. Everything downstream is unchanged: the
same rules, the same four result categories, the same reports, baselines and exit codes.

Pages are found from `sitemap.xml` when the site has one, and by following same-origin
links either way — a sitemap listing three of forty pages would otherwise be worse than
no sitemap at all. `--max-pages` (default 200) and `--max-depth` (default 3) bound it, and
a crawl that stopped early says so.

| Flag | |
| --- | --- |
| `--url <url>` | entry point; the crawl stays on its origin |
| `--max-pages <n>` | stop after this many pages (default 200) |
| `--max-depth <n>` | how far from the entry URL to follow links (default 3) |
| `--allow-remote` | crawl a host that is not localhost |
| `--ignore-robots` | crawl paths `robots.txt` disallows |

**Only localhost, unless you say otherwise.** A tool that fails builds should not be one
flag away from crawling production, or somebody else's site, out of CI, so a non-loopback
host is refused until `--allow-remote` is passed. `robots.txt` is honoured either way
unless `--ignore-robots` says not to.

The origin is re-checked after every redirect, not only at the entry point. A redirect is
the one way out of the origin that neither the link filter nor the sitemap filter sees, so
a page that lands somewhere else is refused and reported rather than audited — a crawl of
`localhost` cannot be redirected onto a host you did not ask for. Redirects that stay on
the origin, such as the trailing-slash ones most servers issue, are followed normally and
the page is reported at the URL it ended up on.

A URL that could not be fetched is named and counted rather than skipped — a crawl that
quietly dropped half a site would report the other half as though it were the whole
thing. Anything that comes back as something other than HTML is refused for the same
reason: auditing a JSON endpoint as markup produces findings about a document that was
never a page.

`--browser` works here too, and navigates Chromium at the real URL rather than serving a
copy of the markup back from disk.

`eaa-kit baseline --url …` records a baseline the same way, so a served site can adopt
the tool exactly as a static one does.

## Which directory to point it at

eaa-kit reads `.html` files off disk. It never starts your dev server, never crawls a URL
and never fetches anything, so the directory has to be one your build has already filled
with real HTML. `./dist` is only the default because that is what most static builders
emit; it is not special.

| Builder | Directory | Note |
| --- | --- | --- |
| Astro, Vite, SvelteKit (static), Nuxt (generate) | `dist/`, `.output/public/` | ready as built |
| Eleventy, Hugo, Jekyll | `_site/`, `public/` | ready as built |
| Create React App | `build/` | one `index.html`; a client-rendered app has little in it |
| Next.js | `out/` | **only with `output: 'export'`** — see below |

**Next.js does not write HTML to `dist/`.** A default `next build` produces `.next/`, which
holds the server bundle rather than a browsable site. To audit the files, set
`output: 'export'` in `next.config.js`, run `next build`, and point eaa-kit at `out/`.

That works only for a site with no server-side rendering, API routes, middleware or ISR.
If yours has any of those, do not fight the export — audit it running instead:

```bash
npm run build && npx next start
eaa-kit audit --url http://localhost:3000
```

A run that reports `No HTML files found` means the directory exists but holds no `.html` —
almost always the wrong directory rather than a clean site.

Output from the test fixtures in this repository, which carry known violations:

```
eaa-kit audit 5 pages · jsdom (browserless)
passed = checked and met · not applicable = nothing to check

about/index.html
  ✓ no violations
    6 passed · 53 not applicable · 4 not evaluated

blog/post-1.html
  ✓ no violations
    4 passed · 55 not applicable · 4 not evaluated

drafts/draft.html
  ✓ no violations
    4 passed · 55 not applicable · 4 not evaluated

index.html
  ✗ image-alt critical, WCAG 1.1.1
      Images must have alternative text
      img
        <img src="/assets/logo.svg">
  ✗ html-has-lang serious, WCAG 3.1.1
      <html> element must have a lang attribute
      html
        <html><head> <title>Startseite</title> </head> <body> <img src="/assets…
  ✗ link-name serious, WCAG 2.4.4 4.1.2
      Links must have discernible text
      a
        <a href="/about/"></a>
  ? bypass needs manual review, WCAG 2.4.1
    3 passed · 51 not applicable · 1 to review · 5 not evaluated

legacy.htm
  ✓ no violations
    4 passed · 55 not applicable · 4 not evaluated

Summary
  3 violations on 1 of 5 pages (3 elements)
  3 at or above serious (--fail-on serious)
  1 rule needs manual review

Not evaluated
  This engine reached no verdict on these.
  They are never reported as passing.
  · color-contrast 5 pages, WCAG 1.4.3
      needs rendered foreground and background colours
  · link-in-text-block 5 pages, WCAG 1.4.1
      needs rendered colours and text decoration
  · no-autoplay-audio 5 pages, WCAG 1.4.2
      needs media duration, and media is never loaded
  · scrollable-region-focusable 5 pages, WCAG 2.1.1 2.1.3
      needs computed overflow
  · target-size 1 page, WCAG 2.5.8
      needs element geometry; every box is 0x0 without layout
```

That run exits 1.

The report goes to stdout and progress goes to stderr, so it can be piped without the
chatter coming along.

## Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--include <globs...>` | `**/*.html`, `**/*.htm` | Glob patterns to audit, relative to `dir` |
| `--exclude <globs...>` | `node_modules`, `.git` | Glob patterns to skip |
| `--base-url <url>` | — | Audit pages under their real site URL instead of `file://` |
| `--fail-on <impact>` | `serious` | Lowest impact that fails the run |
| `--format <format>` | `console` | `console`, `json`, `sarif`, or `html` |
| `--output <path>` | stdout | Write the report to a file; parent directories are created |
| `--browser` | off | Audit in real Chromium instead of jsdom |
| `--concurrency <n>` | from page and core count | Pages to audit at once — threads without `--browser`, tabs with it; `1` turns both off |
| `--fast` | off | Skip the rules the browserless engine cannot decide, rather than running them and discarding the answer |
| `--baseline <path>` | — | Accept the violations recorded in this file; fail only on new ones |

Dot directories such as build caches are skipped by default. `--include` and `--exclude`
replace the defaults rather than adding to them.

### `--fail-on <impact>`

`minor`, `moderate`, `serious` (default) or `critical`. Any violation at or above the
level fails the run.

Violations below the threshold are still reported; they just do not fail the build, and
the summary says why rather than leaving you to guess:

```
Summary
  1 violation on 1 of 1 page (1 element)
  none at or above serious (--fail-on serious), so this run passes
```

Raising the threshold on the run shown above narrows what counts:

```
Summary
  3 violations on 1 of 5 pages (3 elements)
  1 at or above critical (--fail-on critical)
  1 rule needs manual review
```

A violation axe-core did not classify counts at every threshold. A missing impact is a gap
in what we know, not evidence that the failure is harmless.

### `--base-url <url>`

Without it, pages are audited under a `file://` URL derived from their path. With
`--base-url https://example.com`, `about/index.html` is audited as
`https://example.com/about/index.html`, which is how relative links resolve in the report
and in the JSON document's `url` field.

### `--per-page`

Prints every page and its result under the issues. Off by default — see [The Issues
section](#the-issues-section). The other three formats are unaffected: JSON, SARIF and
HTML have always carried every page.

### `--manual`

Prints, for each rule this engine could not evaluate, the check somebody does by hand and
a link to what the criterion actually requires.

```
· color-contrast 7 pages, WCAG 1.4.3
    needs rendered foreground and background colours
    Open the page and check text against its background with a contrast
    checker. Body text needs 4.5:1, and large or bold text 3:1. Check the
    states too — hover, focus, visited, disabled and placeholder text are
    the ones usually missed.
    or run again with --browser
    1.4.3: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
```

Automated testing finds a minority of accessibility barriers, and this tool says so
everywhere. Saying so is not much use on its own: a reader told six rules "could not be
evaluated" is left knowing there is a gap and not what to do about it. This is the rest of
the work, written as something to do rather than a restatement of the criterion.

The links to the WCAG Understanding pages print either way — they are one line. The checks
are behind the flag because they are a paragraph each, and somebody re-running an audit
they already understand does not need them every time. **The HTML report always includes
them**, since that one is read once by whoever is deciding what to do.

### `--format` and `--output`

`--format` selects what is produced; `--output` decides where it goes. Colour is dropped
when the console format is written to a file.

```bash
eaa-kit audit ./dist                                      # console, to the terminal
eaa-kit audit ./dist --format json --output a11y.json     # JSON, to a file
eaa-kit audit ./dist --format sarif --output a11y.sarif   # SARIF, for code scanning
eaa-kit audit ./dist --format html --output a11y.html     # a report you can send someone
```

### `--fast`

The browserless engine runs every rule and then throws some of the answers away.
Colour contrast is computed against a stylesheet jsdom never fetched, target size against
boxes that are all 0x0, and
[what this engine cannot tell you](#what-the-browserless-engine-can-and-cannot-tell-you)
explains why those verdicts are discarded rather than reported. `--fast` switches those
rules off instead of running them.

They are not cheap. Colour contrast is the most expensive rule axe-core has, and skipping
the set is 14-19% of the work on a page — 8-10% of a whole run, once the fixed cost of
starting up is counted in.

**What does not change** is the verdict. Every skipped rule is still reported as *not
evaluated*, with the same reason, and every WCAG criterion still lands in the same bucket:
a criterion this run could not reach still reads as unreached, and a skipped rule never
becomes a pass. The tests assert the coverage view is criterion-for-criterion identical.

**What you lose** is the element list. A rule that runs can say *which* elements it could
not decide — the paragraphs whose contrast needs checking, the controls whose size does —
and those are exactly the elements a person has to look at by hand. A rule that never ran
cannot name them. If you use the report to drive manual checks, that list is the point,
and `--fast` is not for you.

So: worth it on a run whose job is to fail a build on real violations, and not worth it on
a run somebody is going to read.

It has no effect with `--browser`, which can decide those rules for real, and says so
rather than ignoring the flag quietly.

```bash
eaa-kit audit ./dist --fast          # a CI gate
eaa-kit audit ./dist                 # a report somebody will read
```

### `--concurrency <n>`

Both engines audit several pages at once, and this flag sets how many for either.

The browserless engine audits pages across worker threads. Roughly 80% of a page's audit
time is spent inside axe-core with the CPU pinned, so this is the one place where more
cores actually buy something. On a 4-core machine, over 100 pages of a typical marketing
site:

| Threads | Total | Per page |
| --- | --- | --- |
| `--concurrency 1` | 19.9 s | 199 ms |
| 3 (the default here) | 10.0 s | 100 ms |

How many threads are used is decided from how much work the run looks like, not from the
page count: five pages of a real site are worth threading and forty pages of stubs are
not, and what separates them is how much markup there is to walk. Below roughly half a
second of estimated work the run stays on one thread, where a worker would spend longer
loading jsdom than it saves; above it, one worker per ~1.6 s of work, capped at eight and
at one fewer than the core count. A two-core machine never threads. `--concurrency <n>`
overrides all of it, and `--concurrency 1` is the single-threaded path.

Threads change how long the audit takes and nothing else. Pages are reported in the order
they were collected rather than the order they finished, so two runs of the same build
produce byte-identical reports — a test asserts that the threaded and single-threaded
runs agree page for page.

`--browser` uses the same flag, for open tabs rather than threads. The bottleneck there is
the opposite one — a real browser fetches the stylesheets, fonts and images a visitor
would, and spends most of a page waiting on them rather than on the CPU — so waiting on
four at once is close to free. Over 24 pages of a styled site:

| Tabs | Total |
| --- | --- |
| `--concurrency 1` | 17.9 s |
| 4 (the default) | 7.7 s |

The default is four rather than more because each open page holds a document tree, its
decoded images and its own copy of axe-core, and Chromium's memory is the limit rather
than cores. The reports are identical either way: a test asserts that runs at 1, 4 and 8
tabs agree page for page and keep the pages in the order they were collected.

Threads also decide how much memory the run needs, which matters on a large site. jsdom
builds a full DOM per page and axe-core walks it, and V8 does not reclaim that as fast as
the loop produces it, so peak memory tracks the largest heap any one thread has to hold
rather than the size of the build. Each worker is a separate isolate with a heap of its
own, so spreading the pages out lowers the peak:

| 800 pages, 8.3 MB of HTML, 1 GB heap cap | Result |
| --- | --- |
| `--concurrency 1` | out of memory |
| default (3 threads here) | completes |

`--concurrency 1` also gives up the per-page time limit, which is worth knowing before
reaching for it. A document can hold a thread rather than yielding — jsdom's parse and
axe-core's walk are both synchronous — and the only thing that stops work like that is
killing the thread doing it. That is the worker pool's job, so a run with no workers has
no hard ceiling and a pathological page can stall it. The 32 MB per-page limit is what
bounds the damage in that case, and a machine with too few cores to spare one is in the
same position.

The default is the safe one; `--concurrency 1` is the setting to be careful with on a big
site in a memory-capped container. If a run does die with *JavaScript heap out of memory*,
raise the thread count before anything else, then `NODE_OPTIONS=--max-old-space-size=4096`,
then split the run with `--include`.

## The Issues section

The console report leads with the violations grouped by the element that causes them:

```
Issues
  9 violations across the site come from 3 distinct elements.

  ✗ image-alt critical, WCAG 1.1.1
      Images must have alternative text
      <img src="/logo.png">
        on 3 pages:
          index.html  app/page.jsx
          leistungen.html  app/leistungen/page.jsx
          team.html  app/team/page.jsx
        identical on each — likely one shared component
```

The page-by-page listing is the same information keyed the other way round. It is the
right shape for working through one page and the wrong shape for deciding what to do, so
it is printed only under `--per-page`; on a fifty-page site it buries what somebody needs.
On a seven-page fixture the default report is 49 lines against 107.

The page-by-page listing is the truth; on a site built from components it is not the
work. One header with a missing `alt` reappears on every page that renders it, and
nothing in a per-page report says those findings are one line in one file. Elements are
matched on the rule, the selector and the markup — never the path — so the same element
on twenty pages is one entry with twenty places it shows up, and three or more is called
out as likely a shared component.

Rules are ordered worst first, then by how many pages they reach, so the top of the list
is what buys the most. An unclassified impact sorts with the most severe, on the same
reasoning as `--fail-on`.

**Source files.** Where the project uses a router convention, each page is named with the
file that produced it, read from the conventions themselves rather than from a build
manifest, so this does not break when a framework changes its internals.

| Recognised | Read from |
| --- | --- |
| Next.js, both routers | `app/`, `src/app/`, `pages/`, `src/pages/` |
| Remix / React Router | `app/routes/`, including flat routes (`blog.post.tsx`) |
| Nuxt | `pages/` |
| Astro | `src/pages/` |
| Starlight | `src/content/docs/` |
| SvelteKit | `src/routes/` |
| Gatsby | `src/pages/` |
| Docusaurus | `docs/`, under its default `/docs` base path |
| VitePress | `docs/` |
| Hugo | `content/`, including `_index.md` section pages |

Which convention applies is decided by what the project actually is, not by which directory
happens to exist: `src/pages` belongs to Next.js, Astro and Gatsby alike, so the dependency
in `package.json` picks between them.

A dynamic route like `app/blog/[slug]`, `blog.$slug.tsx` or `pages/[id].vue` serves many
paths and is left unmapped rather than guessed at — a wrong file is worse than none.

Two are deliberately not mapped. **Angular** keeps its routes in a TypeScript configuration
object rather than in the filesystem, and reading it would mean parsing or running project
code. **Eleventy and Jekyll** let a page set its own URL in front matter, so the file layout
is not the route; mapping their default convention alone would be right until somebody used
the feature, and quietly wrong after that.

## What to do about a finding

axe-core says what is wrong and links to a page explaining the rule. Neither is the fix, so
each finding carries three more things: who the barrier stops, what to change, and the
corrected form of **the markup that actually failed** rather than a textbook example.

```
  ✗ image-alt critical, WCAG 1.1.1
      Images must have alternative text
      A screen reader announces this image by its filename, or skips it entirely.
      Fix: Add alt text describing what the image conveys. If it is decorative and
      repeats adjacent text, use alt="" so it is skipped deliberately.
      → <img src="/assets/logo.svg" alt="What this image shows">
```

Where the fix genuinely differs by framework, it is given in that framework's idiom — where
`lang` actually lives in a Next.js, Nuxt, Astro, SvelteKit or Remix project is not the same
question as which attribute is missing. For most rules it does not differ, and the same
advice is given whatever built the site: a missing `alt` is a missing `alt` everywhere.

**Deterministic and offline.** No model, no API key, no network call. This tool sits next to
a document with legal weight, and a plausible fix that is wrong is a worse failure here than
no fix at all — somebody would paste it, the report would go green, and the barrier would
still be there.

Findings also name the source file **and line** where the element was written, so
`src/components/Header.astro:12` opens an editor rather than starting a search.

## How much of WCAG a run reaches

WCAG 2.2 has **55 success criteria** at Levels A and AA. axe-core has rules touching **23**
of them. Every run says so:

```
Of the 55 WCAG 2.2 A and AA success criteria, 34 cannot be checked by any
automated engine and need a person. This run reached a verdict on 6.
--browser would answer 4 more criteria.
```

`--coverage` lists all 55 and what this run reached on each. The HTML report always
includes the table.

Each criterion lands in exactly one of four outcomes, and they are never summed or divided
into a score:

| | |
| --- | --- |
| **evaluated here** | A rule for it reached a pass or a violation on this run |
| **this engine could not evaluate it** | A rule exists and this engine is blind to it — `--browser` may answer it |
| **rules ran and found nothing to check** | The rules applied to nothing on this site |
| **no automated rule exists** | Nothing can check it; a person must |

The last is the majority, and it is the point. A tool that reported "23 of 55" as a
percentage would be presenting a limit of automated testing as though it were a measurement
of your site. The denominator here is the standard, not your markup — which is why it is
worth stating at all, and why it never becomes a grade.

`rules ran and found nothing to check` is kept apart from `evaluated` for the same reason
`inapplicable` is kept apart from `passes`: a page with no images proves nothing about
image alternatives.

## Sites that render on a server

A CMS writes no browsable HTML to disk: every page is rendered per request, so there is no
build directory to point at and never was one. `eaa-kit audit` recognises WordPress, TYPO3,
Craft, Laravel, Symfony, Rails and Django, and rather than reporting an empty `./dist` it
says what the project is and how to audit it:

```
./dist does not exist. This is a Laravel project.
  It renders every page on a server and writes no HTML to disk, so there is
  no build directory to audit. Start it, then audit what it serves:
    php artisan serve
    eaa-kit audit --url http://localhost:8000
```

It stops there deliberately. For a static builder, `eaa-kit audit` with no arguments will
run the project's own build and even start its preview server; for a CMS it will do
neither. Starting one of these means spawning a stateful, usually container-backed stack
that may touch a database, which is a great deal more than an accessibility audit was asked
to do — and a `package.json` in a WordPress or Laravel project belongs to a theme's asset
build, so `npm run build` would produce stylesheets and no pages.

**Finding the pages.** Crawling from the front page finds only what the navigation links
to, which on a site with a thousand articles is a menu. A sitemap is the site's own list of
its pages, and `/sitemap.xml` is tried automatically — but a CMS rarely puts it there.
WordPress with Yoast serves `/sitemap_index.xml`, and TYPO3 and Craft put it behind a route
of their own:

```bash
eaa-kit audit --url http://localhost:8000 --sitemap /sitemap_index.xml
```

A named sitemap is used instead of the default rather than as well as it, so a wrong path
is a visible mistake rather than a silent fall back to a crawl that covers less. Whatever
the crawl could not reach is [reported with the run](reports.md#completeness) rather than
counted away.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No violations at or above `--fail-on` |
| `1` | At least one violation at or above `--fail-on` |
| `2` | The audit could not run or could not finish: missing build directory, no HTML found, a page that could not be audited, or a usage error such as an unknown flag |

A page that could not be audited exits `2` rather than `0`. It is neither clean nor
failing, and reporting a pass for markup nothing read would be worse than reporting a
broken run.

### Pages the run declined to read

A file over **32 MB** is not read, and is reported as unmeasured rather than audited.
Nothing about a build guarantees its `.html` files are pages: a generated catalogue, a
database export that happens to carry the extension, a log redirected into the build
directory. Loading one into memory to hand to jsdom is an out-of-memory crash that takes
the whole run with it — every finding on every page that was fine included — so it is
declined instead and named in the run's completeness block. A crawl applies the same limit
to what a server sends it.

For scale: the largest page in this project's own fixtures is 4 KB, and a heavy
real-world documentation page is under 2 MB. A file over the limit is almost never a page
somebody wrote for a person to read.

## What the browserless engine can and cannot tell you

By default eaa-kit globs the HTML out of your build directory, parses it with jsdom and
runs axe-core against the resulting DOM. No Chromium download, fast enough for CI, and it
never fetches anything or executes your site's JavaScript.

The cost is that jsdom has no layout. Every element reports a 0×0 box and computed style
is limited to the inline cascade, so rules that depend on rendering cannot be decided.
axe-core does not know that and will report some of them as **passing** — `target-size`
(WCAG 2.5.8) passes on any page with a link, because a 0×0 target is measured against
nothing.

eaa-kit never passes those on. Rules the engine cannot decide are reported as
**not evaluated**, with the reason, whatever axe-core said about them:

```
Not evaluated
  This engine reached no verdict on these.
  They are never reported as passing.
  · color-contrast 4 pages, WCAG 1.4.3
      needs rendered foreground and background colours
  · target-size 4 pages, WCAG 2.5.8
      needs element geometry; every box is 0x0 without layout
```

Two further consequences worth knowing:

- **Client-rendered pages are mostly invisible to it.** A page whose content is assembled
  by JavaScript at runtime has little in its built HTML to audit, and the report will show
  a small number of passed rules to match.
- **Content inside iframes is not audited**, since nothing is fetched.

`--browser` closes that gap; see below.

## Browser mode

```bash
pnpm add -D playwright          # optional peer dependency
npx playwright install chromium # the browser binary is separate
eaa-kit audit ./dist --browser
```

Same audit, same report shape, in real Chromium. The difference is what it can decide.
On a page whose only defect is `#cccccc` text on white:

```
# jsdom
  ✓ no violations
    6 passed · 52 not applicable · 5 not evaluated

# --browser
  ✗ color-contrast serious, WCAG 1.4.3
    8 passed · 55 not applicable
```

Nothing is reported as unevaluated in browser mode, because with layout and CSS there is
no reason to. Both engines cover the same rule set, so the two reports compare directly.

Three things it does differently, all deliberate:

1. **The build is served over loopback**, not opened as `file://` URLs. Root-absolute asset
   paths — `/assets/site.css`, which every static site generator emits — do not resolve
   under `file://`. Measured on a page whose stylesheet sets `color: #ccc`: the computed
   colour is the default black over `file://` and the real value over `http://`. Auditing
   contrast against an unstyled page would be worse than not auditing it.
2. **Your JavaScript runs.** Client-rendered content is audited as a visitor sees it, which
   is the other half of what the browserless engine cannot reach.
3. **Content-Security-Policy is bypassed** for the audited page, or a site that sets one
   would refuse the injected axe-core and every page would come back unaudited.

Playwright stays an optional peer dependency: the default path never downloads a browser.
Pages are rendered at 1280×720, which is what `target-size` and anything else
layout-dependent is measured against.

### When the browser will not start

Three things can be missing, they need different fixes, and each says which. All exit 2 —
could not run, as distinct from ran and found something — and none prints a stack trace,
because a step you have not run yet is not a crash:

| What it says | What to do |
| --- | --- |
| `Browser mode needs Playwright` | `npm i -D playwright`, then install the browser |
| `Playwright is installed, but the Chromium it drives is not` | `npx playwright install chromium`. The message names the path it looked at, which is where a misdirected `PLAYWRIGHT_BROWSERS_PATH` shows up |
| `Found playwright, but no chromium launcher on it` | An incomplete or mismatched install: `npm i -D playwright@latest` |

Playwright is looked for in the project being audited before this package's own location,
so `npx eaa-kit audit --browser` finds the Playwright in your project rather than in npx's
cache. `@playwright/test` works as well as `playwright`.

## The four result categories

axe-core returns four outcomes per rule, and eaa-kit keeps them separate everywhere,
including in the JSON document. They are not interchangeable:

| Category | Meaning |
| --- | --- |
| `violations` | The rule matched elements and failed |
| `incomplete` | No verdict: either a human has to decide (`needs-review`) or this engine is blind to it (`engine-limitation`) |
| `passes` | The rule matched elements and was met. **The only category that is evidence of anything** |
| `inapplicable` | The rule found nothing to check. Not a pass, and never evidence of compliance |

A page with no images is not compliant with image-alternative requirements; it simply has
nothing to prove. Adding `passes` and `inapplicable` together would score an empty page
near-perfect, which is why eaa-kit never presents a single "rules checked" number.

Every rule axe-core actually runs lands in exactly one of the four, so nothing silently
disappears from a report.
