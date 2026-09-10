# Roadmap

What is planned, and why, newest release first. This is intent rather than a promise: there
are no dates, and anything here can be cut once it turns out to be wrong — one item below
was, and the reasoning is kept rather than the item. What does not change is the rule the
tool is built on: it reports what it found, and it says what it never looked at. Nothing
here is allowed to make a run look more complete than it was.

A section for a released version is left in place with what landed marked on it, so the
record shows what was planned as well as what shipped.

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
