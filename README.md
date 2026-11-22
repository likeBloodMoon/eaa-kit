# eaa-kit

[![CI](https://github.com/likeBloodMoon/eaa-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/likeBloodMoon/eaa-kit/actions/workflows/ci.yml)

eaa-kit checks a website against WCAG 2.2 AA and writes the accessibility statement the
European Accessibility Act asks for. It is meant for freelancers and small agencies, who
have had to comply since 28 June 2025 and rarely have an accessibility budget.

It started with the German BFSG and the Austrian BaFG. The statement now covers fifteen
countries: Austria, Belgium, Czechia, Denmark, Finland, France, Germany, Ireland, Italy,
the Netherlands, Poland, Portugal, Spain, Sweden and Switzerland. Each is written in the
country's own language as well as English, and names its statute and supervisory body.

```bash
npx eaa-kit                       # nothing to set up: finds your site, audits it, writes a report
npx eaa-kit audit                 # WCAG 2.2 AA report; finds your build itself
npx eaa-kit diff a.json b.json    # what a change made worse, and what it fixed
npx eaa-kit init                  # the config, a baseline and a CI pipeline
npx eaa-kit statement             # accessibility statement, in one of fifteen countries
npx eaa-kit countries             # which ones, in which languages, under which law
npx eaa-kit checklist             # the manual review no engine can do for you
npx eaa-kit detect                # what it makes of this project, and why
npx eaa-kit doctor                # everything it needs here, checked on one screen
```

> **Not legal advice.** eaa-kit reports what an automated engine can and cannot determine
> about your markup. Automated testing catches a minority of accessibility barriers, so a
> clean run is a starting point and never a certificate.

## Install

```bash
pnpm add -D eaa-kit    # npm i -D eaa-kit
```

You need Node 22.22, 24.15, or 26 or newer. The odd-numbered lines (23, 25) are not
supported, because jsdom, which the browserless engine is built on, supports only the
even-numbered ones.

## New in 0.11

- `--format markdown` writes a short summary for a CI job page or a pull request comment,
  and `--summary <path>` writes it beside another format. The GitHub Action puts it on the
  job page by default.
- `init` writes a GitLab CI job or a Bitbucket pipeline when the repository lives there,
  as well as the GitHub Actions workflow it wrote before.
- From 1 January 2027, Swedish statements name Digitaliseringsmyndigheten instead of PTS.
  The switch follows the date the statement is generated on, whichever version is
  installed.
- The HTML report prints cleanly, and with a baseline it says what changed since then.
- Credentials given with `--header` or `--basic-auth` now go only to the audited site.
  Before, a redirect to another host, or that site's own third-party assets in browser
  mode, could receive them too.

The [changelog](CHANGELOG.md) has the rest, and every earlier release.

## Auditing

eaa-kit collects the HTML in your build output, parses it with jsdom and runs axe-core on
it. It downloads no browser, it is fast enough for CI, and it never fetches anything or
runs your site's JavaScript. `--browser` uses real Chromium instead, for the rules that need
layout and CSS. `--fast` skips the rules the browserless engine cannot decide anyway,
instead of running them and throwing the answer away.

```bash
eaa-kit audit ./dist --fail-on serious
```

It recognises forty-one stacks, from Next.js, Astro and Nuxt to Qwik, MkDocs and Zola, and
finds the sites in a monorepo from its root. A site that renders on a server and never
writes HTML to disk, such as Next.js without a static export, Nuxt or SvelteKit, is built,
started and crawled when you run `eaa-kit audit` with no directory. A Next.js app is
audited page by page from its own build manifests, so pages nothing links to are covered
too. A single-page app's empty shell is reported as not audited, instead of passing.

A site behind a CMS is never started for you. Start it yourself and audit it while it runs.
WordPress, TYPO3, Craft, Laravel, Symfony, Rails and Django write no HTML to disk, so
eaa-kit tells you the command that gets the site running, and follows the site's own
sitemap wherever it keeps it:

```bash
eaa-kit audit --url http://localhost:3000
eaa-kit audit --url http://localhost:8000 --sitemap /sitemap_index.xml
```

Before it crawls, a `--url` run checks where the address leads. A redirect to another site
needs your confirmation (or `--redirects follow`), and a sign-in page stops the run instead
of being audited as if it were the site.

A preview deployment or a staging CMS refuses anonymous requests. `--basic-auth` and a
repeatable `--header` get past that, both when crawling and in the browser. The
credentials go to the audited site and nowhere else. They are never written into a report,
a baseline or a SARIF log, and `eaa.config` does not accept them, because it is a committed
file.

```bash
eaa-kit audit --url https://preview.example.com --basic-auth user:password
```

### What it tells you to do

Each finding says who the barrier stops, what to change, and gives the corrected form of
your own markup, in your framework's idiom where that differs. The advice is written into
the tool, so it works offline and needs no model or API key, and it cannot invent a fix
that looks right and is wrong.

```
✗ image-alt critical, WCAG 1.1.1
    A screen reader announces this image by its filename, or skips it entirely.
    Fix: Add alt text describing what the image conveys…
    → <img src="/assets/logo.svg" alt="What this image shows">
    written in src/components/Header.astro:12
```

### Failing only on what is new

The first run on an existing site finds everything at once. A baseline records what is
already wrong, so the build fails on regressions instead. An accepted barrier is still
reported as a barrier, and never as a pass.

```bash
eaa-kit baseline ./dist
eaa-kit audit ./dist --baseline eaa-baseline.json
```

`diff` compares two reports: what is new, what was fixed, and what the later run never
looked at. That last group is kept apart, because a violation missing from a run that
stopped early was not fixed by anybody.

```bash
eaa-kit diff before.json after.json
```

### Only what changed, and while you work

A page whose markup has not changed byte for byte since the last run keeps the result it
already had, and a run with nothing to re-audit never loads an engine. Twenty pages take
about 230 ms instead of about 2,520 ms, which is roughly what starting the process costs.
Every report counts reused results apart from fresh ones, and `diff` will not call a page
fixed that this run did not look at. `--no-cache` audits everything. `pnpm bench` measures
these numbers on your own machine.

`--watch` audits again every time the build changes. With the cache, only the pages you
touched are audited again, so the report is usually ready by the time you switch windows.

```bash
eaa-kit audit ./dist --watch
```

### Reports

There are five formats. The console report is for whoever ran the command, JSON is for
other tools, SARIF is for GitHub code scanning, and Markdown is a short summary for a CI job
or a pull request. The HTML report is a single file you can send to the client whose site it
is, and it prints or saves as a PDF.

A run that stopped at its page limit, or could not fetch some URLs, says so. Its report does
not look like a complete one.

## The statement

eaa-kit writes the statement from one config file, as Markdown or HTML: a
Barrierefreiheitserklärung, a déclaration d'accessibilité, a dichiarazione di
accessibilità, or whatever the country calls it. It names the country's statute and
supervisory body, and can list the barriers an audit found.

```bash
eaa-kit statement --output src/content/a11y.md
eaa-kit statement --country PL --lang pl    # eaa-kit countries lists all fifteen
```

Each country's statement is written under its own law, not translated from another
country's. Where a national regime asks for more, such as France's RGAA declaration or
Italy's filing with AgID, the text says so.

When the law has already scheduled a change of supervisor, the statement follows the date
it is generated on. `--date` previews either side:

```bash
eaa-kit statement --country SE --lang sv --date 2027-01-01
```

The statement says what you told it, and eaa-kit cannot check whether that is true. A
statement claiming full conformance for a site that does not conform is worse than none, so
given evidence it refuses to write one: `statement --audit` will not claim full
conformance over a report that lists barriers, and `--review` will not claim it over
criteria somebody recorded as not met.

## The part no engine can do

WCAG 2.2 has 55 success criteria at Levels A and AA. This tool has rules for 21 of them,
and the other 34 need a person. Every run says so, and `--coverage` lists all 55 with what
the run reached on each. There is no percentage, because most of WCAG cannot be automated
and a score would present that as a fact about your site.

`eaa-kit checklist` writes the 34 out as a worksheet and a record. `audit --review` reads
the record back and reports what a person checked next to what the run measured, without
mixing the two. A review never overrules the engine, and it never counts an entry nobody
answered or one that has aged out.

```bash
eaa-kit checklist --output a11y-review.md
eaa-kit audit --review eaa-review.json --coverage
```

## Setting it up

`eaa-kit init` asks the few things it cannot work out, fills in the rest from what the built
site states, and writes the config. It then offers a baseline and a CI pipeline written for
the project: a GitHub Actions workflow, a GitLab CI job or a Bitbucket pipeline, depending on
where the repository is hosted. It never overwrites a pipeline file that is already there.

Flags you would repeat on every run can go in `eaa.config`, the same file the statement
reads, as an [`audit` block](docs/audit.md#defaults-from-eaaconfig). `baseline` reads the
keys that mean the same thing to it. A flag you type still wins, so a one-off `--browser`
check needs no edit to a committed file.

```jsonc
{ "audit": { "dir": "build", "failOn": "critical", "browser": true } }
```

It also runs inside your build: a [Vite plugin](docs/integrations.md#vite-plugin) that
covers SvelteKit and Remix as well, integrations for
[Astro](docs/integrations.md#astro-integration),
[Nuxt](docs/integrations.md#nuxt-module),
[Eleventy](docs/integrations.md#eleventy-plugin) and
[webpack](docs/integrations.md#webpack-plugin), and the bundled
[GitHub Action](docs/integrations.md#github-actions). GitLab and Bitbucket have
[pipelines of their own](docs/integrations.md#gitlab-ci).

## Documentation

| | |
| --- | --- |
| [Auditing a build](docs/audit.md) | The `audit` command, both engines, exit codes, and what an automated run can and cannot tell you |
| [Defaults from eaa.config](docs/audit.md#defaults-from-eaaconfig) | Writing the flags down once, and what still overrides them |
| [The statement command](docs/statement.md) | The config file, the fifteen countries, and filling a statement from audit results |
| [Baselines](docs/baseline.md) | Adopting the tool on a site that already has violations |
| [Comparing two runs](docs/reports.md#comparing-two-runs) | The `diff` command, and what it refuses to call fixed |
| [Coverage of WCAG](docs/audit.md#how-much-of-wcag-a-run-reaches) | What an automated engine can reach at all, and what it cannot |
| [Recording a manual review](docs/review.md) | The `checklist` command, the record, and what a review is not allowed to do |
| [Report formats](docs/reports.md) | The JSON contract, SARIF, the Markdown summary and the HTML report |
| [Integrations](docs/integrations.md) | The build plugins, the GitHub Action, GitLab CI and Bitbucket Pipelines |

Generated output for every format is checked in under [examples/](examples).

## What it cannot tell you

Automated testing finds a minority of barriers. It cannot judge whether alternative text is
accurate, whether a page makes sense in reading order, or whether a form can actually be
completed with a screen reader. A clean report means this engine found nothing, which is
different from the site being accessible, and none of the formats will claim otherwise on
your behalf. Every report also counts the 34 criteria no automated rule covers.

The browserless engine cannot decide everything either. jsdom has no layout, so rules that
depend on rendering, such as colour contrast, target size and computed overflow, cannot be
evaluated. axe-core does not know that, and reports some of them as passing. eaa-kit reports
them as not evaluated, with the reason, whatever axe-core said. See [what the browserless
engine can and cannot tell
you](docs/audit.md#what-the-browserless-engine-can-and-cannot-tell-you).

## Contributing and security

[CONTRIBUTING.md](CONTRIBUTING.md) covers setting up the repository and what a change needs
before it is merged. To report a vulnerability, follow [SECURITY.md](SECURITY.md) rather than
opening a public issue.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for every release, and [ROADMAP.md](ROADMAP.md) for what
is planned on the way to 1.0 and what will deliberately stay out.

## License

MIT
