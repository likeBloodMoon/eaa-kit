import axe from 'axe-core'
import { type SuccessCriterion, WCAG22_AA_CRITERIA } from './criteria.ts'
import { manualCheckFor } from './manual.ts'
import { DEFAULT_TAGS, ENGINE_BLIND_RULES, type PageAudit, successCriteria } from './result.ts'
import { type CriterionReview, criterionReview, type ReviewOptions } from './review.ts'

/**
 * How much of WCAG this run could reach at all.
 *
 * The tool refuses to divide passes by failures, and it is right to: only
 * `passes` is evidence, `inapplicable` is not, and the two summed would make an
 * empty page look compliant. But refusing that number left nothing in its
 * place, so a reader got a page of honest disclaimers and no measurement, and
 * "automated testing finds a minority of barriers" stayed a sentence rather
 * than a figure.
 *
 * There is an honest denominator, and it is the standard rather than the DOM.
 * WCAG 2.2 has 55 success criteria at Levels A and AA. axe-core has rules
 * touching 23 of them. That is the number nobody publishes, and it is the most
 * useful thing this tool can say about its own limits: most of WCAG cannot be
 * checked by any automated engine, and no amount of green output changes it.
 *
 * Four outcomes, and every criterion lands in exactly one — the same discipline
 * `shapeResults` enforces for rules, for the same reason. They must never be
 * summed into a score.
 */

export { type Level, type SuccessCriterion, WCAG22_AA_CRITERIA } from './criteria.ts'

/**
 * What this run established about one criterion.
 *
 * `nothing-to-check` is kept apart from `evaluated` deliberately. A rule that
 * ran and found no matching element has not shown that the criterion is met —
 * a page with no images proves nothing about image alternatives — and folding
 * the two together would be the same mistake as adding `inapplicable` to
 * `passes`.
 */
export type CoverageStatus =
  | 'evaluated'
  | 'not-evaluated'
  | 'nothing-to-check'
  | 'no-automated-rule'

export interface CriterionCoverage extends SuccessCriterion {
  status: CoverageStatus
  /** Rules in scope that map to this criterion, sorted. */
  rules: string[]
  /**
   * What a person recorded about this criterion, when a review was supplied.
   *
   * Beside `status` rather than folded into it: `status` is what this engine
   * reached, and a person's answer is a different kind of claim with a
   * different standing. Present even when it does not count, because an entry
   * the run refused to count is exactly the thing a reader should see.
   */
  review?: CriterionReview
  /**
   * True when re-running with `--browser` would move this out of
   * `not-evaluated`. False means a person has to look, whatever engine runs.
   */
  browserWouldAnswer: boolean
}

export interface Coverage {
  criteria: CriterionCoverage[]
  /** A rule reached a pass or a violation here. */
  evaluated: number
  /** A rule exists and this engine could not decide it. */
  notEvaluated: number
  /** Rules ran and found nothing on this site to check. */
  nothingToCheck: number
  /** No automated rule exists at all. Somebody has to look. */
  noAutomatedRule: number
  /** Of `notEvaluated`, how many `--browser` would answer. */
  browserWouldAnswer: number
  /** Everything above sums to this: the criteria in WCAG 2.2 at A and AA. */
  total: number
  /**
   * Criteria this engine did not decide that a person recorded a result for.
   *
   * Counted apart from the four above and never added to them. Those four
   * partition the standard by what the engine reached; this says how much of
   * the remainder somebody has been through, which is a claim by a person
   * rather than a measurement, and the two must not be summed into one figure.
   */
  reviewed: number
  /** Of `reviewed`, how many a person recorded as not met. */
  reviewedNotMet: number
  /** Entries read and not counted: stale, undated, or already decided here. */
  reviewNotCounted: number
}

/**
 * Rules axe-core would run under these tags, mapped to the criteria they cover.
 *
 * Experimental rules are excluded, matching `blindRulesInScope`: axe-core leaves
 * them off by default, so counting them as coverage would promise checks that
 * never run.
 */
export function rulesByCriterion(tags: readonly string[]): Map<string, string[]> {
  const byCriterion = new Map<string, string[]>()
  for (const rule of axe.getRules([...tags])) {
    if (rule.tags.includes('experimental')) continue
    for (const criterion of successCriteria(rule.tags)) {
      const rules = byCriterion.get(criterion)
      if (rules) rules.push(rule.ruleId)
      else byCriterion.set(criterion, [rule.ruleId])
    }
  }
  for (const rules of byCriterion.values()) rules.sort()
  return byCriterion
}

/** Rule ids this run reached a pass or a violation on, across every page. */
function decidedRules(audits: readonly PageAudit[]): Set<string> {
  const decided = new Set<string>()
  for (const audit of audits) {
    for (const finding of audit.violations) decided.add(finding.ruleId)
    for (const finding of audit.accepted ?? []) decided.add(finding.ruleId)
    for (const outcome of audit.passes) decided.add(outcome.ruleId)
  }
  return decided
}

/** Rule ids this run reached no verdict on because the engine cannot see them. */
function blindedRules(audits: readonly PageAudit[]): Set<string> {
  const blind = new Set<string>()
  for (const audit of audits) {
    for (const finding of audit.incomplete) {
      if (finding.reason === 'engine-limitation') blind.add(finding.ruleId)
    }
  }
  return blind
}

/**
 * What this run reached, criterion by criterion.
 *
 * `audits` decides `evaluated` rather than the engine's capabilities alone: a
 * rule that could have run and never matched anything has not established that
 * the criterion is met on this site, and saying otherwise would be a coverage
 * claim resting on an empty page.
 */
export function buildCoverage(
  audits: readonly PageAudit[],
  tags: readonly string[] = DEFAULT_TAGS,
  review?: ReviewOptions,
): Coverage {
  const byCriterion = rulesByCriterion(tags)
  const decided = decidedRules(audits)
  const blinded = blindedRules(audits)
  // ENGINE_BLIND_RULES is a fact about jsdom, not about auditing. Consulting it
  // for a run that used real Chromium made the browser report contradict
  // itself: colour contrast and target size came back as "this engine could not
  // evaluate it", and the summary advised re-running with --browser — the flag
  // that run was already using. A browser sees layout and CSS, so the only
  // rules it reached no verdict on are the ones its own results said so about,
  // which `blinded` already holds.
  // An empty run keeps the table: there is no browser result to argue it away.
  const jsdomBlindApplies =
    audits.length === 0 || audits.some((audit) => audit.engine !== 'browser')

  const criteria: CriterionCoverage[] = WCAG22_AA_CRITERIA.map((criterion) => {
    const rules = byCriterion.get(criterion.number) ?? []

    if (rules.length === 0) {
      return { ...criterion, status: 'no-automated-rule', rules, browserWouldAnswer: false }
    }

    if (rules.some((rule) => decided.has(rule))) {
      return { ...criterion, status: 'evaluated', rules, browserWouldAnswer: false }
    }

    // No verdict. Either the engine is blind to a rule here, or every rule ran
    // and matched nothing — different facts with different remedies, so they
    // are not folded together.
    const engineBlind = rules.filter(
      (rule) => blinded.has(rule) || (jsdomBlindApplies && ENGINE_BLIND_RULES[rule] !== undefined),
    )

    // One blind rule is enough. Requiring all of them was wrong on the one
    // criterion where the rules are mixed: WCAG 2.1.1 Keyboard has
    // scrollable-region-focusable, which needs computed overflow, alongside two
    // this engine can see — so a page with no frames and no image maps reported
    // 2.1.1 as "nothing to check" while the same report's rule listing said
    // scrollable-region-focusable had reached no verdict. One document
    // contradicting itself about a Level A criterion, and in the direction that
    // understates the gap.
    if (engineBlind.length > 0) {
      return {
        ...criterion,
        status: 'not-evaluated',
        rules,
        // `browserAnswers` is recorded per rule beside the manual check. If a
        // browser resolves every rule standing between here and a verdict, then
        // re-running with --browser is a real answer; otherwise a person looks
        // whatever engine runs.
        browserWouldAnswer: engineBlind.every(
          (rule) => manualCheckFor(rule)?.browserAnswers === true,
        ),
      }
    }

    return { ...criterion, status: 'nothing-to-check', rules, browserWouldAnswer: false }
  })

  const reviewed = review === undefined ? criteria : criteria.map(withReview(review))

  const count = (status: CoverageStatus): number =>
    reviewed.filter((criterion) => criterion.status === status).length

  const counted = reviewed.filter((criterion) => criterion.review?.counts === true)

  return {
    criteria: reviewed,
    evaluated: count('evaluated'),
    notEvaluated: count('not-evaluated'),
    nothingToCheck: count('nothing-to-check'),
    noAutomatedRule: count('no-automated-rule'),
    browserWouldAnswer: reviewed.filter((criterion) => criterion.browserWouldAnswer).length,
    total: WCAG22_AA_CRITERIA.length,
    reviewed: counted.length,
    reviewedNotMet: counted.filter((criterion) => criterion.review?.result === 'not-met').length,
    reviewNotCounted: reviewed.filter((criterion) => criterion.review?.counts === false).length,
  }
}

/**
 * Attach what a person recorded, without letting it move what the engine found.
 *
 * `status` is untouched here, deliberately and in every branch: a review adds a
 * second kind of claim beside the run's own, and the moment it could rewrite
 * one the report would stop being a record of what was measured.
 */
function withReview(review: ReviewOptions): (criterion: CriterionCoverage) => CriterionCoverage {
  return (criterion) => {
    const recorded = criterionReview(criterion.number, review, criterion.status === 'evaluated')
    return recorded === undefined ? criterion : { ...criterion, review: recorded }
  }
}

/**
 * The sentence a reader needs before drawing anything from a clean report.
 *
 * Deliberately leads with what was not checked. A report that opened with "23
 * criteria evaluated" would read as a score, which is precisely what this
 * refuses to be.
 */
export function coverageSummary(coverage: Coverage): string {
  const unautomatable = coverage.noAutomatedRule
  return (
    `Of the ${coverage.total} WCAG 2.2 A and AA success criteria, ` +
    `${unautomatable} cannot be checked by any automated engine and need a person. ` +
    `This run reached a verdict on ${coverage.evaluated}.`
  )
}

/**
 * What a person added to the run, in one sentence, or nothing when nobody did.
 *
 * Kept out of `coverageSummary` so the sentence about the engine's reach does
 * not change shape depending on whether a review was supplied — and because a
 * reader has to be able to tell the two claims apart at a glance: one is what
 * an engine measured, the other is what somebody says they checked.
 */
export function reviewSummary(coverage: Coverage): string | undefined {
  if (coverage.reviewed === 0 && coverage.reviewNotCounted === 0) return undefined

  const parts = [
    `A person recorded a result for ${coverage.reviewed} of the criteria this run did not reach`,
  ]
  if (coverage.reviewedNotMet > 0) {
    parts.push(`${coverage.reviewedNotMet} of them as not met`)
  }
  if (coverage.reviewNotCounted > 0) {
    parts.push(`${coverage.reviewNotCounted} further entries were not counted`)
  }
  return `${parts.join('; ')}. This is a claim by a person, not a measurement.`
}
