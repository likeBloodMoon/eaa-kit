import { IMPACT_LEVELS } from '../audit/impact.ts'
import * as s from '../schema.ts'

/** Countries with their own supervisory body and statute text. */
export const COUNTRIES = ['AT', 'DE', 'CH', 'ES', 'FR', 'IT', 'NL'] as const
export type Country = (typeof COUNTRIES)[number]

/**
 * Languages a statement can be rendered in.
 *
 * Not every country has every one: a statement is a document under a particular
 * legal regime, not a translation of a document under another, so each country
 * has the language it is published in and English. `renderStatement` says which
 * ones a country has when asked for one it does not.
 */
export const STATEMENT_LOCALES = ['de', 'en', 'es', 'fr', 'it', 'nl'] as const
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

/**
 * Report formats the `audit` block accepts.
 *
 * Spelled out here rather than imported from `src/cli/audit.ts`, which pulls
 * the console reporter in statically: this module is reachable from the
 * package entry point and from every build integration, and none of them
 * should pay for a reporter to read a config file. A test asserts the two
 * lists agree, so a format cannot be added to one and not the other.
 */
export const AUDIT_FORMATS = ['console', 'json', 'sarif', 'html'] as const
export type AuditFormat = (typeof AUDIT_FORMATS)[number]

/**
 * Defaults for `eaa-kit audit` and `eaa-kit baseline`, so a project says once
 * what every invocation would otherwise repeat.
 *
 * Every field is optional and every one is a default: a flag actually typed on
 * the command line wins, because the file is the project's usual answer and the
 * flag is somebody asking for something else right now.
 *
 * `baseline` reads the subset that means the same thing to it. `output`,
 * `format`, `failOn` and `baseline` are audit-only on purpose — a baseline
 * written to the report's path would overwrite the report, and a threshold for
 * failing a run means nothing to a command that records what it finds.
 */
const auditSchema = s.object({
  /** Build directory. The positional argument wins over it. */
  dir: s.optional(s.string({ min: 1 })),
  include: s.optional(s.array(s.string({ min: 1 }))),
  exclude: s.optional(s.array(s.string({ min: 1 }))),
  /** Audit pages under their real site URL instead of file://. */
  baseUrl: s.optional(s.url()),
  /** Audit a running site instead of a directory. */
  url: s.optional(s.url()),
  /** Crawl a host that is not loopback. Off unless a project says otherwise. */
  allowRemote: s.optional(s.boolean()),
  ignoreRobots: s.optional(s.boolean()),
  /** Where the site lists its pages, when that is not /sitemap.xml. */
  sitemap: s.optional(s.string({ min: 1 })),
  maxPages: s.optional(s.integer({ min: 1 })),
  /** 0 audits the entry page alone. */
  maxDepth: s.optional(s.integer({ min: 0 })),
  /** Lowest impact that exits 1. */
  failOn: s.optional(s.enumeration(IMPACT_LEVELS)),
  format: s.optional(s.enumeration(AUDIT_FORMATS)),
  /** Write the report here instead of stdout. */
  output: s.optional(s.string({ min: 1 })),
  /** Audit in real Chromium. Needs the playwright peer. */
  browser: s.optional(s.boolean()),
  /** Skip the rules the browserless engine cannot decide. No effect with `browser`. */
  fast: s.optional(s.boolean()),
  concurrency: s.optional(s.integer({ min: 1 })),
  /** Path to a baseline; violations it accounts for do not fail the run. */
  baseline: s.optional(s.string({ min: 1 })),
  /** List every page and its result under the issues. */
  perPage: s.optional(s.boolean()),
  /** Print the manual check for each rule the engine could not evaluate. */
  manual: s.optional(s.boolean()),
  /** List every WCAG 2.2 A/AA criterion and what the run reached on it. */
  coverage: s.optional(s.boolean()),
  /**
   * False is `--no-build`: never run the project's build or start its server to
   * find something to audit. Written in the positive because that is the state
   * being described, and because a config file has no flags to negate.
   */
  build: s.optional(s.boolean()),
})

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
  /** Defaults for the audit commands. Nothing here reaches the statement. */
  audit: s.optional(auditSchema),
})

/**
 * The `audit` block on its own.
 *
 * A project that only wants audit defaults should not have to write a complete
 * statement config to get them, and `s.object` drops the keys it does not know,
 * so the same file satisfies both readers: `statement` demands the whole
 * document, `audit` reads this and ignores the rest.
 */
const auditConfigSchema = s.object({ audit: s.optional(auditSchema) })

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
  audit?: AuditConfig
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
 * The `audit` block, as written and as parsed — every field is optional.
 *
 * `undefined` is mapped out of the value types rather than left in them:
 * `s.object` never writes a key it did not parse, so an absent field is an
 * absent key, and the commands spread this over their own options where a
 * present-but-undefined key would overwrite a real value.
 */
export type AuditConfig = {
  [K in keyof s.Infer<typeof auditSchema>]?: Exclude<s.Infer<typeof auditSchema>[K], undefined>
}

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
  return parse(configSchema, value, source)
}

/**
 * Read only the `audit` block, ignoring whatever else the file holds.
 *
 * Returns undefined where there is no block, which is the common case: most
 * config files exist for the statement alone, and finding one is not a reason
 * to change how an audit runs.
 */
export function parseAuditConfig(value: unknown, source = 'config'): AuditConfig | undefined {
  // The cast drops `| undefined` from each field's type, which the parser has
  // already dropped from the value: `s.object` writes a key only when it read
  // one. See AuditConfig for why that distinction is worth keeping.
  return parse(auditConfigSchema, value, source).audit as AuditConfig | undefined
}

function parse<T>(schema: s.Schema<T>, value: unknown, source: string): T {
  const result = s.safeParse(schema, value)
  if (result.success) return result.data

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
  throw new ConfigError(`${source} is not valid`, issues)
}
