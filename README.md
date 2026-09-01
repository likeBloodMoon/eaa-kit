# eaa-kit

[![CI](https://github.com/likeBloodMoon/eaa-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/likeBloodMoon/eaa-kit/actions/workflows/ci.yml)

Build-time WCAG 2.2 AA auditor and EU accessibility statement generator for static sites,
built for the freelancers and small agencies who have to comply with the European
Accessibility Act (in force since 28 June 2025) without an accessibility budget. It started
in the DACH region — the BFSG in Germany, the BaFG in Austria — and the statement now names
the statute and supervisory body of **seven countries**: Austria, Germany, Switzerland,
Spain, France, Italy and the Netherlands, each in its own language as well as English.

```bash
npx eaa-kit audit                 # WCAG 2.2 AA report; finds your build itself
npx eaa-kit diff a.json b.json    # what a change made worse, and what it fixed
npx eaa-kit init                  # write an eaa.config.json
npx eaa-kit statement             # accessibility statement, in one of seven countries
```

> **Not legal advice.** eaa-kit reports what an automated engine can and cannot determine
> about your markup. Automated testing catches a minority of accessibility barriers; it is
> a floor, not a certificate.

## Install

```bash
pnpm add -D eaa-kit    # npm i -D eaa-kit
```

Node 22.22, 24.15 or 26 and newer. jsdom, which the browserless engine is built on,
supports only the even-numbered release lines, so the odd-numbered ones (23, 25) are not
supported here either.

## What it does

**Audits your build.** Globs the HTML out of `./dist`, parses it with jsdom and runs
axe-core against it. No Chromium download, fast enough for CI, and it never fetches
anything or executes your site's JavaScript. `--browser` swaps in real Chromium for the
rules that need layout and CSS; `--fast` goes the other way and skips the rules the
browserless engine cannot decide anyway, rather than running them and discarding the
answer.

```bash
eaa-kit audit ./dist --fail-on serious
```

Sites that render on a server and never write HTML to disk — Next.js without a static
export, Nuxt, SvelteKit, anything behind a CMS — are audited running instead:

```bash
eaa-kit audit --url http://localhost:3000
```

**Writes the statement.** A Barrierefreiheitserklärung, a déclaration d'accessibilité, a
dichiarazione di accessibilità — whatever the country calls it — from one config file, as
Markdown or HTML, naming that country's statute and supervisory body, and optionally
listing the barriers a real audit found.

```bash
eaa-kit statement --output src/content/a11y.md
eaa-kit statement --country FR --lang fr    # or ES, IT, NL, AT, DE, CH
```

Each country's statement is a document under its own law rather than a translation of
another's, so where a national regime asks for more than this — France's RGAA declaration,
Italy's filing with AgID — the text says so instead of letting a generated file look like
it settles the matter.

**Fails only on what is new.** The first run on a site that already exists finds
everything at once. A baseline records what is already wrong so the build fails on
regressions instead, without ever letting an accepted barrier look like a passing one.

```bash
eaa-kit baseline ./dist
eaa-kit audit ./dist --baseline eaa-baseline.json
```

**Says what a change did.** Two reports, and the difference between them: what is new, what
was fixed, and what the later run never looked at — which is kept apart, because a
violation missing from a run that stopped early was not fixed by anybody.

```bash
eaa-kit diff before.json after.json
```

**Says what to do about it.** Not "images must have alternative text" and a link — who the
barrier stops, what to change, and the corrected form of *your* markup, in your framework's
idiom where that differs. Deterministic and offline: no model, no API key, nothing that
could invent a fix that looks right and is not.

```
✗ image-alt critical, WCAG 1.1.1
    A screen reader announces this image by its filename, or skips it entirely.
    Fix: Add alt text describing what the image conveys…
    → <img src="/assets/logo.svg" alt="What this image shows">
    written in src/components/Header.astro:12
```

**Says how much of WCAG it could reach.** WCAG 2.2 has 55 success criteria at Levels A and
AA. axe-core has rules touching 23 of them. Every run says so, and `--coverage` lists all
55 with what this run reached on each — never as a percentage, because most of WCAG cannot
be automated and a score would present that as a fact about your site.

**Says what it did not measure.** A crawl that stopped at its page limit, or could not
fetch forty URLs, no longer produces a report that looks like a complete one.

**Reports in four shapes**: a console report for whoever ran it, JSON for other tools,
SARIF for GitHub code scanning, and a self-contained HTML page for the client whose site
it is.

**Says it once.** The flags a project runs on every build belong in the project, not in the
build script that repeats them. `eaa.config` — the same file the statement reads — takes an
[`audit` block](docs/audit.md#defaults-from-eaaconfig) of defaults, and `baseline` reads the
keys that mean the same thing to it. A flag you type still wins, so a one-off `--browser`
check needs no edit to a committed file.

```jsonc
{ "audit": { "dir": "build", "failOn": "critical", "browser": true } }
```

**Runs in your build**: a [Vite plugin](docs/integrations.md#vite-plugin) covering SvelteKit
and Remix too, and integrations for
[Astro](docs/integrations.md#astro-integration),
[Nuxt](docs/integrations.md#nuxt-module),
[Eleventy](docs/integrations.md#eleventy-plugin) and
[webpack](docs/integrations.md#webpack-plugin) — or the bundled
[GitHub Action](docs/integrations.md#github-actions).

**Audits what a CMS serves.** WordPress, TYPO3, Craft, Laravel, Symfony, Rails and Django
write no HTML to disk, so eaa-kit names the command that gets the site running and audits
that instead — following the site's own sitemap, wherever it keeps it.

```bash
eaa-kit audit --url http://localhost:8000 --sitemap /sitemap_index.xml
```

## Documentation

| | |
| --- | --- |
| [Auditing a build](docs/audit.md) | The `audit` command, both engines, exit codes, and what an automated run can and cannot tell you |
| [Defaults from eaa.config](docs/audit.md#defaults-from-eaaconfig) | Writing the flags down once, and what still overrides them |
| [The statement command](docs/statement.md) | The config file, the seven countries, and filling a statement from audit results |
| [Baselines](docs/baseline.md) | Adopting the tool on a site that already has violations |
| [Comparing two runs](docs/reports.md#comparing-two-runs) | The `diff` command, and what it refuses to call fixed |
| [Coverage of WCAG](docs/audit.md#how-much-of-wcag-a-run-reaches) | What an automated engine can reach at all, and what it cannot |
| [Report formats](docs/reports.md) | The JSON contract, SARIF, and the HTML report |
| [Integrations](docs/integrations.md) | The build plugins, the GitHub Action, and the two builders that get a command instead |

Complete generated output for every format is checked in under [examples/](examples).

## What it will not tell you

The two things worth knowing before you rely on any of it:

**Automated testing finds a minority of barriers.** It cannot judge whether alternative
text is accurate, whether a page makes sense in reading order, or whether a form can
actually be completed with a screen reader. A clean report means nothing was found by this
engine, which is not the same as a site being accessible — and none of the four output
formats will say otherwise on your behalf. This is not a disclaimer the tool leaves you to
take on faith: it counts it. Of the 55 WCAG 2.2 A and AA criteria, 34 have no automated
rule at all, and every report says so.

**The browserless engine cannot decide everything.** jsdom has no layout, so rules that
depend on rendering — colour contrast, target size, computed overflow — cannot be
evaluated. axe-core does not know that and will report some of them as *passing*. eaa-kit
never passes those on: they are reported as **not evaluated**, with the reason, whatever
axe-core said about them. See [what the browserless engine can and cannot tell
you](docs/audit.md#what-the-browserless-engine-can-and-cannot-tell-you).

The same applies to the statement: it says what you told it. eaa-kit cannot check whether
those claims are true, and a statement claiming full conformance for a site that is not
conformant is worse than no statement at all.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
