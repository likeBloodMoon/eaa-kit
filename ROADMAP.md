# Roadmap

What is planned after 0.5.0, and why. This is intent rather than a promise: there are no
dates, and anything here can be cut once it turns out to be wrong. What does not change is
the rule the tool is built on — it reports what it found, and it says what it never looked
at. Nothing below is allowed to make a run look more complete than it was.

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
- A review older than the pages it covers is reported as stale, with its date, rather than
  silently counted. The audit already fingerprints pages; that is what tells it.
- An unreviewed criterion stays unreviewed. Generating the checklist is not doing the check,
  and no output will imply otherwise.
- Unfilled entries in the record are not "in progress" — they are absent from the coverage
  view exactly as they are today.

### 3. Auditing only what changed

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

A baseline is an amnesty for what a site already gets wrong. Nothing currently makes anyone
look at one again, and an amnesty with no end date is a decision that gets made once and
never revisited.

Each entry records when it was accepted. `--max-age` fails a run on entries older than a
period the project sets. `baseline --prune` removes entries the current build no longer
produces, and the audit reports how many entries went unmatched — an accepted barrier that
stopped appearing is either fixed or on a page the run never reached, and those are not the
same thing.

### 6. Maintenance

- axe-core within 4.x, and a test that fails when its rule set moves, because the WCAG
  coverage claim is computed from that set and is a claim about facts.
- Node 26 in the CI matrix.
- Dependency and toolchain bumps.

### Not in 0.6.0

- **Writing fixes into source files.** `remediation` prints the corrected form of your
  markup; editing somebody's components is a different level of trust and needs an opt-in,
  a dry run and a much stronger story about mis-attribution. Revisit for 0.7.
- **A score, a percentage or a grade.** Not in 0.6.0 and not later. Most of WCAG cannot be
  automated, and a number would present that as a fact about a site.
- **Level AAA.**
- **Anything generated by a model.** The remediation advice is deterministic and offline so
  that it cannot invent a fix that looks right. That does not change.
- **A hosted dashboard or an account.** This is a command that runs in your build.

### Order of work

1. `ponytail` and the examples drift check — everything after this is smaller for it.
2. The `report/` compaction pass, before checklist and cache add fields to all four formats.
3. `checklist` and the review record.
4. The page cache.
5. The four countries — independent of the rest, and can land at any point.
6. Baseline expiry, then maintenance and release.

### Done means

- `lint`, `typecheck`, `test`, `smoke` and the packaged-CLI run green across the CI matrix.
- `examples/` regenerated, reviewed as output rather than as a diff, and drift-checked in CI.
- Schema versions moved only where a field changed meaning, and the changelog saying which
  and why — new fields alone do not move them.
- A changelog entry that says what was given up as well as what was added, which is the
  convention the 0.5.0 entry set for `--fast`.
- The `src` and `tests` line counts, reported rather than claimed.
