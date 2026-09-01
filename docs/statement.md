# The statement command

Generates an accessibility statement (Barrierefreiheitserklärung) from a config file and,
optionally, from an audit report — in German or English, as Markdown or HTML, with the
statute and supervisory body of the country you name.

```bash
eaa-kit statement                                   # to stdout
eaa-kit statement --output src/content/a11y.md      # to a file
eaa-kit statement --lang en --country DE            # override both
eaa-kit statement --output public/a11y.html         # a standalone HTML page
eaa-kit statement --audit a11y.json                 # list what the audit found
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--config <path>` | searched for | Path to the config file |
| `--lang <locale>` | from `site.locale` | `de` or `en` |
| `--country <code>` | from `enforcement.country` | `AT`, `CH` or `DE` |
| `--audit <path>` | — | A report from `eaa-kit audit --format json`; its violations are listed as non-accessible content |
| `--format <format>` | from `--output` | `markdown` or `html` |
| `--output <path>` | stdout | Write to a file; parent directories are created |

Exit codes are `0` when the statement was produced and `2` when it could not be: no
config, an invalid one, a country whose template does not exist yet, or an audit report
that could not be read.

Every statement carries the five sections the EU model requires: conformance status,
non-accessible content with a reason for each barrier, how to send feedback, the
enforcement procedure, and when the statement was prepared.

## Writing the config

```bash
eaa-kit init
```

Asks for the few things it cannot work out — who is answerable for the site, where
feedback goes, whose law applies — takes the site name and URL from `package.json` where
they are stated, and writes an `eaa.config.json` the loader accepts. It refuses to
overwrite a config that is already there without `--force`, and `--yes` takes every
default without asking.

What it writes is `partially-compliant`, never `compliant`. The file is written before any
audit has run, and a statement claiming full conformance for a site nobody has assessed is
worse than no statement at all.


## Markdown or HTML

`--format` decides what is produced and `--output` where it goes. With no `--format`, an
`--output` path ending in `.html` or `.htm` produces HTML and anything else produces
Markdown, so `--output public/a11y.html` needs no second flag.

The HTML is one self-contained page: a `<title>`, `lang` on the root element, `<main>`,
real headings and lists, and a small `<style>` block that follows the reader's light or
dark preference. It has no external assets and no scripts, which is what makes it
publishable by copying one file. The markup inside `<main>` carries no classes, so pasting
that part into your own layout and dropping the `<style>` block works too. The page is
audited by the test suite with eaa-kit's own engine, on the principle that a statement
generator emitting an inaccessible statement has failed at the one job it has.

## The config file

`eaa.config.ts`, `.mts`, `.js`, `.mjs` or `.json`, found by walking up from the working
directory. TypeScript configs are read directly — Node strips the types, so there is no
build step and no loader dependency.

The same file can carry an [`audit` block](audit.md#defaults-from-eaaconfig) of defaults
for `eaa-kit audit`. Nothing in it reaches the statement, and nothing here reaches an
audit; they share a file, not a meaning.

```ts
import { defineConfig } from 'eaa-kit'

export default defineConfig({
  site: {
    name: 'Musterbetrieb',
    url: 'https://example.at',
    locale: 'de-AT',              // decides the statement language unless --lang is given
  },
  provider: {
    legalName: 'Musterbetrieb GmbH',
    email: 'office@example.at',   // required: the feedback address the EAA obliges you to offer
    phone: '+43 1 2345678',       // optional
    address: 'Hauptstraße 1, 1010 Wien',  // optional
    feedbackUrl: 'https://example.at/kontakt',  // optional: a contact or feedback form
  },
  compliance: {
    status: 'partially-compliant',        // 'compliant' | 'partially-compliant' | 'non-compliant'
    standard: 'EN 301 549 V3.2.1 (WCAG 2.2 AA)',   // optional, this is the default
    assessedOn: '2026-08-21',             // ISO date, validated
    assessmentMethod: 'self-assessment',  // or 'external-audit'
    auditReason: 'fix-planned',           // reason given to barriers from --audit
    knownIssues: [
      {
        description: 'Die eingebettete Karte hat keinen Titel.',
        successCriteria: ['4.1.2'],       // WCAG
        en301549: ['9.4.1.2'],            // EN 301 549 clauses
        reason: 'fix-planned',            // or 'disproportionate-burden' | 'out-of-scope'
        remedyBy: '2026-12-31',
      },
      'Ältere PDF-Dokumente sind nicht barrierefrei.',   // shorthand for { description }
    ],
  },
  enforcement: {
    country: 'AT',   // AT, CH or DE
  },
})
```

A complete example config is at [examples/eaa.config.json](../examples/eaa.config.json), and
the statements it produces are at [examples/statement.de.md](../examples/statement.de.md),
[examples/statement.en.md](../examples/statement.en.md) and
[examples/statement.de.html](../examples/statement.de.html).

## What it produces

```markdown
# Erklärung zur Barrierefreiheit

Musterbetrieb GmbH ist bemüht, die Website Musterbetrieb im Einklang mit dem
österreichischen Barrierefreiheitsgesetz (BaFG) barrierefrei zugänglich zu machen. Das
BaFG setzt die Richtlinie (EU) 2019/882 (European Accessibility Act) in österreichisches
Recht um.

…

## Nicht barrierefreie Inhalte

- Die eingebettete Karte hat keinen Titel.
  Betroffene Anforderung: WCAG 4.1.2, EN 301 549 9.4.1.2
  Grund: die Barriere ist bekannt und wird behoben.
  Geplante Behebung bis: 31. Dezember 2026
- Ältere PDF-Dokumente sind nicht barrierefrei.

## Beschwerdeverfahren

Wenn Sie mit unserer Antwort nicht zufrieden sind, können Sie sich an das
Sozialministeriumservice wenden. …
```

The `AT` template names the Barrierefreiheitsgesetz and the Sozialministeriumservice; the
`DE` template names the Barrierefreiheitsstärkungsgesetz and the Marktüberwachungsstelle
der Länder (MLBF). Both statutes transpose Directive (EU) 2019/882.

## Switzerland is not the EU

`CH` is a different document, not a translation of the other two, because Swiss law is
genuinely different and a statement that pretended otherwise would be stating something
false about it.

- **The BehiG is not an EAA transposition.** The Behindertengleichstellungsgesetz
  (SR 151.3) predates Directive (EU) 2019/882 and does not implement it. The Swiss
  template says so, and adds that a provider selling products or services into the EU may
  fall under the EAA regardless — which is presumably why a Swiss user is running a tool
  called eaa-kit in the first place.
- **There is no supervisory body to complain to.** Austria has the Sozialministeriumservice
  and Germany the MLBF; Switzerland has no market surveillance authority for the websites
  of private providers. Rather than invent one, the `CH` enforcement section names the
  remedies that do exist — a court action under Article 8 BehiG, an action brought by a
  disability organisation under Article 9 — and points at the EBGB for general information.
- **The technical standard is eCH-0059**, which the federal government made a binding ICT
  requirement in 2021 and which requires WCAG 2.1 AA. `compliance.standard` still defaults
  to EN 301 549 for every country, because what you assessed against is a fact about your
  assessment rather than about your address — a Swiss provider selling into the EU may
  well mean EN 301 549. Set it explicitly if you mean the Swiss standard:

  ```ts
  compliance: {
    standard: 'eCH-0059 V3.0 (WCAG 2.1 AA)',
  }
  ```

One thing the template deliberately leaves out: today the revised BehiG binds public
bodies, not private companies, and the Federal Council is still reviewing whether to
extend it. Whether you are obliged to publish a statement at all is a question for you and
your lawyer, and it is not something a generated document should assert on your behalf —
so it says nothing about it, and neither does this README.

## Barriers from an audit run

```bash
eaa-kit audit ./dist --format json --output a11y.json
eaa-kit statement --audit a11y.json --output src/content/a11y.md
```

Each rule the audit found failing becomes one entry under non-accessible content, folded
across every page it failed on, and the entries the config describes stay first:

```markdown
- Ältere PDF-Dokumente sind nicht barrierefrei.
- Images must have alternative text
  Betroffene Anforderung: WCAG 1.1.1, EN 301 549 9.1.1.1
  Betroffene Seiten: index.html
  Grund: die Barriere ist bekannt und wird behoben.
  Automatisiert erkannt (axe-core, Regel image-alt); bitte in eigenen Worten beschreiben.
```

**Those descriptions are axe-core's, and axe-core speaks English.** Generating German
legal prose out of an English rule description behind your back would be worse than
showing you where it came from, so each entry says so and asks to be rewritten — in the
statement's language, in your own words, about your own site. The wording is in the
document rather than only in a warning on stderr, because the person who publishes the
statement is not always the person who ran the command.

Four more things this does deliberately:

- **Only violations become barriers.** A rule that needs manual review has not been found
  inaccessible, and a rule this engine could not evaluate has not been found anything at
  all. Both are reported as counts in the "preparation" section instead, so a reader can
  see how much the automated run left open rather than mistaking the list for the whole
  picture.
- **The reason is a setting, not a guess.** An audit report carries no reason for a
  barrier existing, so every derived entry gets `compliance.auditReason`, which defaults
  to `fix-planned`. Disproportionate burden and out-of-scope are claims only you can make.
- **Affected pages are listed, up to five**, and counted after that, so a site-wide
  barrier does not turn the statement into a sitemap.
- **Barriers are ordered worst first**, with an unclassified impact leading, on the same
  reasoning as `--fail-on`: not knowing how bad a barrier is is not evidence that it is
  mild.

The statement never repeats the audit's verdict on your behalf either: `--audit` does not
touch `compliance.status`. Declaring the site partially or fully conformant stays a
decision you make in the config.

## Read it before you publish it

**The generated statement is a draft, not legal advice, and it says so in its own last
paragraph.** It states what you told it: the status you declared and the barriers you
listed. eaa-kit cannot check whether those claims are true, and a statement claiming full
conformance for a site that is not conformant is worse than no statement at all.

That applies twice over to barriers taken from `--audit`: they arrive as English rule
descriptions with a line asking you to rewrite them, and publishing them as they stand
means publishing a German legal document containing English tool output — and a to-do
note addressed to yourself.
