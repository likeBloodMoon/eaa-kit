# eaa-kit

[![CI](https://github.com/likeBloodMoon/eaa-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/likeBloodMoon/eaa-kit/actions/workflows/ci.yml)

Build-time WCAG 2.2 AA auditor and EU accessibility statement generator for static sites,
aimed at freelancers and small agencies in the DACH region who have to comply with the
European Accessibility Act (in force since 28 June 2025), the BFSG in Germany and the BaFG
in Austria.

```bash
npx eaa-kit audit ./dist          # WCAG 2.2 AA report over built HTML
npx eaa-kit statement             # Barrierefreiheitserklärung from eaa.config
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
rules that need layout and CSS.

```bash
eaa-kit audit ./dist --fail-on serious
```

Sites that render on a server and never write HTML to disk — Next.js without a static
export, Nuxt, SvelteKit, anything behind a CMS — are audited running instead:

```bash
eaa-kit audit --url http://localhost:3000
```

**Writes the statement.** A Barrierefreiheitserklärung from one config file, in German or
English, as Markdown or HTML, naming the statute and supervisory body of Austria,
Switzerland or Germany — and optionally listing the barriers a real audit found.

```bash
eaa-kit statement --output src/content/a11y.md
```

**Fails only on what is new.** The first run on a site that already exists finds
everything at once. A baseline records what is already wrong so the build fails on
regressions instead, without ever letting an accepted barrier look like a passing one.

```bash
eaa-kit baseline ./dist
eaa-kit audit ./dist --baseline eaa-baseline.json
```

**Reports in four shapes**: a console report for whoever ran it, JSON for other tools,
SARIF for GitHub code scanning, and a self-contained HTML page for the client whose site
it is.

**Runs in your build**, as an [Astro integration](docs/integrations.md#astro-integration)
or the bundled [GitHub Action](docs/integrations.md#github-actions).

## Documentation

| | |
| --- | --- |
| [Auditing a build](docs/audit.md) | The `audit` command, both engines, exit codes, and what an automated run can and cannot tell you |
| [The statement command](docs/statement.md) | The config file, the three countries, and filling a statement from audit results |
| [Baselines](docs/baseline.md) | Adopting the tool on a site that already has violations |
| [Report formats](docs/reports.md) | The JSON contract, SARIF, and the HTML report |
| [Integrations](docs/integrations.md) | Astro and GitHub Actions |

Complete generated output for every format is checked in under [examples/](examples).

## What it will not tell you

The two things worth knowing before you rely on any of it:

**Automated testing finds a minority of barriers.** It cannot judge whether alternative
text is accurate, whether a page makes sense in reading order, or whether a form can
actually be completed with a screen reader. A clean report means nothing was found by this
engine, which is not the same as a site being accessible — and none of the four output
formats will say otherwise on your behalf.

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
