import { describe, expect, it } from 'vitest'
import { REVIEW_SCHEMA_VERSION, type ReviewRecord } from '../../src/audit/review.ts'
import type { EaaConfigInput } from '../../src/config/define.ts'
import { parseConfig } from '../../src/config/define.ts'
import { checkStatementEvidence, refuses } from '../../src/statement/evidence.ts'
import type { AuditFinding, AuditSummary } from '../../src/statement/findings.ts'

const TODAY = new Date('2026-09-09T00:00:00Z')

const BASE: EaaConfigInput = {
  site: { name: 'Musterbetrieb', url: 'https://example.at', locale: 'de-AT' },
  provider: { legalName: 'Musterbetrieb GmbH', email: 'office@example.at' },
  compliance: { status: 'partially-compliant', assessedOn: '2026-08-21' },
  enforcement: { country: 'AT' },
}

function config(compliance: Partial<EaaConfigInput['compliance']> = {}) {
  return parseConfig({ ...BASE, compliance: { ...BASE.compliance, ...compliance } })
}

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    ruleId: 'image-alt',
    help: 'Images must have alternative text',
    impact: 'critical',
    successCriteria: ['1.1.1'],
    en301549: ['9.1.1.1'],
    pages: ['index.html'],
    ...overrides,
  }
}

function audit(overrides: Partial<AuditSummary> = {}): AuditSummary {
  return {
    findings: [finding()],
    pages: 5,
    needsReview: 0,
    notEvaluated: 0,
    generatedAt: '2026-08-20T09:30:00.000Z',
    ...overrides,
  }
}

function review(criteria: ReviewRecord['criteria']): ReviewRecord {
  return { schemaVersion: REVIEW_SCHEMA_VERSION, criteria }
}

describe('a claim of full conformance', () => {
  it('is refused when the audit found barriers', () => {
    const problems = checkStatementEvidence({
      config: config({ status: 'compliant' }),
      audit: audit(),
      today: TODAY,
    })

    expect(refuses(problems)).toBe(true)
    expect(problems[0]?.message).toContain('1 barrier on 1 page')
    // The fix is in the message: partially-compliant is the ordinary answer,
    // and somebody filling in a config for the first time does not know that.
    expect(problems[0]?.message).toContain('partially-compliant')
  })

  it('is refused when a person recorded a criterion as not met', () => {
    const problems = checkStatementEvidence({
      config: config({ status: 'compliant' }),
      review: review({
        '1.3.2': { result: 'not-met', reviewedOn: '2026-09-01' },
        '2.1.1': { result: 'met', reviewedOn: '2026-09-01' },
      }),
      today: TODAY,
    })

    expect(refuses(problems)).toBe(true)
    expect(problems[0]?.message).toContain('1.3.2')
    expect(problems[0]?.message).not.toContain('2.1.1')
  })

  it('stands when the audit found nothing', () => {
    const problems = checkStatementEvidence({
      config: config({ status: 'compliant' }),
      audit: audit({ findings: [] }),
      today: TODAY,
    })

    expect(refuses(problems)).toBe(false)
  })

  it('stands when nobody has recorded anything as not met', () => {
    const problems = checkStatementEvidence({
      config: config({ status: 'compliant' }),
      review: review({ '1.3.2': { result: 'unreviewed' }, '2.1.1': { result: 'met' } }),
      today: TODAY,
    })

    expect(refuses(problems)).toBe(false)
  })

  it('is not checked at all without evidence, because there is nothing to check it against', () => {
    // A project that has never run an audit gets the statement it always got.
    // The tool cannot audit what it was not shown, and refusing here would be
    // an accusation rather than a finding.
    const problems = checkStatementEvidence({
      config: config({ status: 'compliant' }),
      today: TODAY,
    })

    expect(refuses(problems)).toBe(false)
  })
})

describe('other claims', () => {
  it('are left alone: partial conformance and barriers agree with each other', () => {
    const problems = checkStatementEvidence({
      config: config({ status: 'partially-compliant' }),
      audit: audit(),
      review: review({ '1.3.2': { result: 'not-met', reviewedOn: '2026-09-01' } }),
      today: TODAY,
    })

    expect(refuses(problems)).toBe(false)
  })

  it('including non-conformance, which nothing can contradict', () => {
    const problems = checkStatementEvidence({
      config: config({ status: 'non-compliant' }),
      audit: audit(),
      today: TODAY,
    })

    expect(refuses(problems)).toBe(false)
  })
})

describe('the dates', () => {
  it('warn, and never refuse: an old date is not a false claim', () => {
    const problems = checkStatementEvidence({
      config: config({ assessedOn: '2024-01-01' }),
      today: TODAY,
    })

    expect(refuses(problems)).toBe(false)
    expect(problems.map((problem) => problem.severity)).toEqual(['warns'])
  })

  it('say when the assessment date is older than a year', () => {
    const problems = checkStatementEvidence({
      config: config({ assessedOn: '2024-01-01' }),
      today: TODAY,
    })

    expect(problems[0]?.message).toContain('2024-01-01')
    expect(problems[0]?.message).toContain('nobody has assessed since')
  })

  it('say when the assessment date is in the future', () => {
    const problems = checkStatementEvidence({
      config: config({ assessedOn: '2027-01-01' }),
      today: TODAY,
    })

    expect(problems[0]?.message).toContain('in the future')
  })

  it('say when the audit ran after the date the statement gives', () => {
    // The document would claim an assessment that did not include the run it
    // cites, which is a different document from the one somebody meant.
    const problems = checkStatementEvidence({
      config: config({ assessedOn: '2026-08-21' }),
      audit: audit({ generatedAt: '2026-09-01T09:30:00.000Z' }),
      today: TODAY,
    })

    expect(problems.some((problem) => problem.message.includes('after the 2026-08-21'))).toBe(true)
  })

  it('say when the report being cited is more than a year old', () => {
    const problems = checkStatementEvidence({
      config: config({ assessedOn: '2026-08-21' }),
      audit: audit({ generatedAt: '2025-01-01T09:30:00.000Z' }),
      today: TODAY,
    })

    expect(problems.some((problem) => problem.message.includes('the site had then'))).toBe(true)
  })

  it('say nothing when the claim, the run and today line up', () => {
    expect(
      checkStatementEvidence({
        config: config({ assessedOn: '2026-08-21' }),
        audit: audit(),
        today: TODAY,
      }),
    ).toEqual([])
  })
})
