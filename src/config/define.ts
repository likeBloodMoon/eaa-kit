import * as s from '../schema.ts'

/** Countries with their own supervisory body and statute text. */
export const COUNTRIES = ['AT', 'DE', 'CH'] as const
export type Country = (typeof COUNTRIES)[number]

/** Languages a statement can be rendered in. */
export const STATEMENT_LOCALES = ['de', 'en'] as const
export type StatementLocale = (typeof STATEMENT_LOCALES)[number]

/**
 * Wording follows the EU model statement: fully, partially, or not conformant
 * with the standard. "partially-compliant" is the honest answer for most sites
 * and the one that carries obligations to list what is missing.
 */
export const COMPLIANCE_STATUSES = ['compliant', 'partially-compliant', 'non-compliant'] as const
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number]

export const ASSESSMENT_METHODS = ['self-assessment', 'external-audit'] as const
export type AssessmentMethod = (typeof ASSESSMENT_METHODS)[number]

/**
 * Why a known barrier still exists. The first two are the grounds the EU regime
 * recognises for leaving something inaccessible; the third is a plain promise to
 * fix it, which is what most small sites actually mean.
 */
export const ISSUE_REASONS = ['disproportionate-burden', 'out-of-scope', 'fix-planned'] as const
export type IssueReason = (typeof ISSUE_REASONS)[number]

const knownIssueObject = s.object({
  /** What is not accessible, in the statement's language. */
  description: s.string({ min: 1 }),
  /** WCAG success criteria, e.g. ['1.4.3']. */
  successCriteria: s.withDefault(s.array(s.string()), () => []),
  /** EN 301 549 clauses, e.g. ['9.1.4.3']. */
  en301549: s.withDefault(s.array(s.string()), () => []),
  reason: s.optional(s.enumeration(ISSUE_REASONS)),
  /** ISO date by which the barrier is expected to be removed. */
  remedyBy: s.optional(s.isoDate()),
})

/**
 * A bare string is accepted as shorthand for `{ description }`. It is put
 * through the object schema so both branches produce the same output type,
 * rather than a union that callers have to narrow before reading `remedyBy`.
 */
const knownIssueSchema = s.union(
  [
    s.pipe(
      s.transform(s.string({ min: 1 }), (description) => ({ description })),
      knownIssueObject,
    ),
    knownIssueObject,
  ],
  'expected a description, or an object with one',
)

export const configSchema = s.object({
  site: s.object({
    name: s.string({ min: 1 }),
    url: s.url(),
    /** BCP 47 tag of the site itself, e.g. 'de-AT'. */
    locale: s.string({ min: 2 }),
  }),
  provider: s.object({
    /** The legal entity answerable for the service. */
    legalName: s.string({ min: 1 }),
    /**
     * The feedback address. Required: the EAA obliges providers to offer a way
     * to report accessibility barriers, and a statement without one is not
     * usable for its purpose.
     */
    email: s.email(),
    phone: s.optional(s.string({ min: 1 })),
    address: s.optional(s.string({ min: 1 })),
    /**
     * A contact or feedback form, offered alongside the address rather than
     * instead of it: the EAA requires a way to report barriers, and a form is
     * the one channel a visitor who cannot use email may still be able to use.
     */
    feedbackUrl: s.optional(s.url()),
  }),
  compliance: s.object({
    status: s.enumeration(COMPLIANCE_STATUSES),
    standard: s.withDefault(s.string({ min: 1 }), () => 'EN 301 549 V3.2.1 (WCAG 2.2 AA)'),
    knownIssues: s.withDefault(s.array(knownIssueSchema), () => []),
    /** When the assessment was carried out. */
    assessedOn: s.isoDate(),
    assessmentMethod: s.withDefault(
      s.enumeration(ASSESSMENT_METHODS),
      () => 'self-assessment' as const,
    ),
    /**
     * Reason attached to barriers taken from an audit report, which carries no
     * reason of its own. 'fix-planned' is the honest default for a barrier an
     * automated run just found; the other two are claims only a human can make.
     */
    auditReason: s.withDefault(s.enumeration(ISSUE_REASONS), () => 'fix-planned' as const),
  }),
  enforcement: s.object({
    /** Drives which supervisory body and statute the template names. */
    country: s.enumeration(COUNTRIES),
  }),
})

/**
 * What an author writes in `eaa.config.ts`.
 *
 * Written out rather than inferred from the schema. It is the type people see
 * in their editor while filling the file in, so it is worth being readable, and
 * it differs from the parsed type in two ways inference makes awkward: fields
 * with defaults may be left out, and a known issue may be a bare string.
 */
export interface EaaConfigInput {
  site: { name: string; url: string; locale: string }
  provider: {
    legalName: string
    email: string
    phone?: string
    address?: string
    feedbackUrl?: string
  }
  compliance: {
    status: ComplianceStatus
    standard?: string
    knownIssues?: Array<string | KnownIssueInput>
    assessedOn: string
    assessmentMethod?: AssessmentMethod
    auditReason?: IssueReason
  }
  enforcement: { country: Country }
}

/** One barrier, as written in a config file. */
export interface KnownIssueInput {
  description: string
  successCriteria?: string[]
  en301549?: string[]
  reason?: IssueReason
  remedyBy?: string
}
export type EaaConfig = s.Infer<typeof configSchema>
export type KnownIssue = EaaConfig['compliance']['knownIssues'][number]

/**
 * Identity function that gives `eaa.config.ts` its types. Deliberately does not
 * validate: a config file is loaded and checked in one place, so that an error
 * points at the file rather than at wherever the module happened to be
 * imported.
 */
export function defineConfig(config: EaaConfigInput): EaaConfigInput {
  return config
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError'

  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message)
  }
}

/** Validate an already-loaded config object. */
export function parseConfig(value: unknown, source = 'config'): EaaConfig {
  const result = s.safeParse(configSchema, value)
  if (result.success) return result.data

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
  throw new ConfigError(`${source} is not valid`, issues)
}
