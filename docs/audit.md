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
| `--concurrency <n>` | from page and core count | Worker threads to audit with; `1` audits in one thread |
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

### `--format` and `--output`

`--format` selects what is produced; `--output` decides where it goes. Colour is dropped
when the console format is written to a file.

```bash
eaa-kit audit ./dist                                      # console, to the terminal
eaa-kit audit ./dist --format json --output a11y.json     # JSON, to a file
eaa-kit audit ./dist --format sarif --output a11y.sarif   # SARIF, for code scanning
eaa-kit audit ./dist --format html --output a11y.html     # a report you can send someone
```

### `--concurrency <n>`

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

The Chromium engine is unaffected: `--browser` drives one browser context sequentially,
where the bottleneck is the browser rather than this process.

Threads also decide how much memory the run needs, which matters on a large site. jsdom
builds a full DOM per page and axe-core walks it, and V8 does not reclaim that as fast as
the loop produces it, so peak memory tracks the largest heap any one thread has to hold
rather than the size of the build. Each worker is a separate isolate with a heap of its
own, so spreading the pages out lowers the peak:

| 800 pages, 8.3 MB of HTML, 1 GB heap cap | Result |
| --- | --- |
| `--concurrency 1` | out of memory |
| default (3 threads here) | completes |

The default is the safe one; `--concurrency 1` is the setting to be careful with on a big
site in a memory-capped container. If a run does die with *JavaScript heap out of memory*,
raise the thread count before anything else, then `NODE_OPTIONS=--max-old-space-size=4096`,
then split the run with `--include`.

## The Issues section

Under the page-by-page listing, the report groups violations by the element that causes
them:

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
file that produced it. Next.js (both routers), Nuxt, Astro and SvelteKit are recognised,
read from the conventions themselves rather than from a build manifest, so this does not
break when a framework changes its internals. A dynamic route like `app/blog/[slug]` serves
many paths and is left unmapped rather than guessed at — a wrong file is worse than none.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No violations at or above `--fail-on` |
| `1` | At least one violation at or above `--fail-on` |
| `2` | The audit could not run or could not finish: missing build directory, no HTML found, a page that could not be audited, or a usage error such as an unknown flag |

A page that could not be audited exits `2` rather than `0`. It is neither clean nor
failing, and reporting a pass for markup nothing read would be worse than reporting a
broken run.

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

Playwright stays an optional peer dependency: the default path never downloads a browser,
and `--browser` without it exits 2 with the two commands above rather than a stack trace.
Pages are rendered at 1280×720, which is what `target-size` and anything else
layout-dependent is measured against.

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
