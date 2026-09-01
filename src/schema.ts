/**
 * The small amount of schema validation this package actually needs.
 *
 * It replaced zod, which is 6.4 MB of a 37 MB install for three closed schemas
 * — the config file, the JSON report and the baseline — each already wrapped in
 * hand-written error messages. Paying that on every install of an accessibility
 * linter was not a good trade.
 *
 * The shape mirrors what it replaced closely enough that the call sites did not
 * change: `safeParse` returns either the parsed value or a list of issues with
 * a path, and the callers turn those into their own messages.
 *
 * Deliberately not a general-purpose validator. It does what these three
 * schemas need and no more; anything else should be added here when a schema
 * needs it, rather than guessed at now.
 */

export interface Issue {
  /** Where in the document, e.g. ['provider', 'email'] or ['pages', 0, 'path']. */
  path: Array<string | number>
  message: string
}

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: Issue[] } }

/**
 * A validator that reads `value` and either returns a value of type T or
 * records why it could not.
 *
 * `read` returns undefined when it recorded an issue. Callers must check
 * `issues.length` rather than the return value, since undefined is also a legal
 * parsed value for an optional field.
 */
export interface Schema<T> {
  read(value: unknown, path: Array<string | number>, issues: Issue[]): T | undefined
  /** Present when the field may be absent, so objects know not to require it. */
  readonly isOptional?: boolean
  /** Supplies a value when the field is absent. */
  readonly fallback?: () => T
}

/**
 * Marks a field that may be absent from the output object, not merely undefined
 * in it. `withDefault` is absent from the *input* but always present in the
 * output, so only `optional` carries this.
 */
declare const OPTIONAL: unique symbol
export type OptionalSchema<T> = Schema<T | undefined> & { readonly [OPTIONAL]: true }

export type Infer<S> =
  S extends OptionalSchema<infer T> ? T | undefined : S extends Schema<infer T> ? T : never

type OptionalKeys<S> = {
  [K in keyof S]: S[K] extends OptionalSchema<unknown> ? K : never
}[keyof S]

/** Optional fields become optional keys, so `exactOptionalPropertyTypes` holds. */
export type ObjectOf<S> = {
  [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]>
} & {
  [K in OptionalKeys<S>]?: Infer<S[K]>
}

/**
 * A field with a default: absent from what an author writes, always present in
 * what comes out.
 */
declare const DEFAULTED: unique symbol
export type DefaultedSchema<T> = Schema<T> & { readonly [DEFAULTED]: true }

export function safeParse<T>(schema: Schema<T>, value: unknown): ParseResult<T> {
  const issues: Issue[] = []
  const data = schema.read(value, [], issues)
  if (issues.length > 0) return { success: false, error: { issues } }
  return { success: true, data: data as T }
}

function fail(issues: Issue[], path: Array<string | number>, message: string): undefined {
  issues.push({ path, message })
  return undefined
}

/** Marks a schema as allowed to be absent. */
export function optional<T>(inner: Schema<T>): OptionalSchema<T> {
  return {
    isOptional: true,
    read: (value, path, issues) =>
      value === undefined ? undefined : inner.read(value, path, issues),
  } as OptionalSchema<T>
}

/** Supplies a value when the field is absent. Never when it is present and wrong. */
export function withDefault<T>(inner: Schema<T>, fallback: () => T): DefaultedSchema<T> {
  return {
    isOptional: true,
    fallback,
    read: (value, path, issues) =>
      value === undefined ? fallback() : inner.read(value, path, issues),
  } as DefaultedSchema<T>
}

/** Reads with `inner`, then reshapes what came back. */
export function transform<T, U>(inner: Schema<T>, map: (value: T) => U): Schema<U> {
  return {
    read: (value, path, issues) => {
      const before = issues.length
      const parsed = inner.read(value, path, issues)
      return issues.length === before ? map(parsed as T) : undefined
    },
  }
}

/**
 * Reads with `first`, then reads that result with `second`.
 *
 * Lets a shorthand form be widened into the full one and validated by the same
 * schema, so both branches of a union produce one type rather than a union the
 * callers have to narrow.
 */
export function pipe<T, U>(first: Schema<T>, second: Schema<U>): Schema<U> {
  return {
    read: (value, path, issues) => {
      const before = issues.length
      const parsed = first.read(value, path, issues)
      return issues.length === before ? second.read(parsed, path, issues) : undefined
    },
  }
}

export function nullable<T>(inner: Schema<T>): Schema<T | null> {
  return {
    read: (value, path, issues) => (value === null ? null : inner.read(value, path, issues)),
  }
}

export function string(options: { min?: number } = {}): Schema<string> {
  return {
    read: (value, path, issues) => {
      if (typeof value !== 'string') return fail(issues, path, 'expected a string')
      if (options.min !== undefined && value.length < options.min) {
        return fail(
          issues,
          path,
          options.min === 1 ? 'must not be empty' : `must be at least ${options.min} characters`,
        )
      }
      return value
    },
  }
}

export function boolean(): Schema<boolean> {
  return {
    read: (value, path, issues) =>
      typeof value === 'boolean' ? value : fail(issues, path, 'expected true or false'),
  }
}

export function number(): Schema<number> {
  return {
    read: (value, path, issues) =>
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : fail(issues, path, 'expected a number'),
  }
}

/** One of a fixed set. The message lists them, since that is the useful part. */
export function enumeration<const T extends readonly string[]>(values: T): Schema<T[number]> {
  return {
    read: (value, path, issues) =>
      typeof value === 'string' && (values as readonly string[]).includes(value)
        ? (value as T[number])
        : fail(issues, path, `expected one of ${values.join(', ')}`),
  }
}

export function array<T>(item: Schema<T>): Schema<T[]> {
  return {
    read: (value, path, issues) => {
      if (!Array.isArray(value)) return fail(issues, path, 'expected an array')
      const out: T[] = []
      for (const [index, element] of value.entries()) {
        const before = issues.length
        const parsed = item.read(element, [...path, index], issues)
        if (issues.length === before) out.push(parsed as T)
      }
      return out
    },
  }
}

/**
 * An object with a known shape. Unknown keys are dropped rather than carried
 * along, which is what keeps a config file from smuggling fields the templates
 * never asked for into a legal document.
 */
export function object<S extends Record<string, Schema<any>>>(shape: S): Schema<ObjectOf<S>> {
  return {
    read: (value, path, issues) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(issues, path, 'expected an object')
      }
      const source = value as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [key, schema] of Object.entries(shape)) {
        // Own keys only: `config['constructor']` reaches Object.prototype and
        // comes back defined, which would read a function as a field value.
        const present = Object.hasOwn(source, key)
        const raw = present ? source[key] : undefined
        if (!present && schema.isOptional !== true) {
          fail(issues, [...path, key], 'is required')
          continue
        }
        const before = issues.length
        const parsed = schema.read(raw, [...path, key], issues)
        if (issues.length === before && parsed !== undefined) out[key] = parsed
      }
      return out as ObjectOf<S>
    },
  }
}

/** An object of unknown keys, all values sharing one shape. */
export function record<T>(value: Schema<T>): Schema<Record<string, T>> {
  return {
    read: (input, path, issues) => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return fail(issues, path, 'expected an object')
      }
      const out: Record<string, T> = {}
      for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
        const before = issues.length
        const parsed = value.read(raw, [...path, key], issues)
        if (issues.length === before) out[key] = parsed as T
      }
      return out
    },
  }
}

/**
 * The first alternative that accepts the value.
 *
 * Reports only the last failure rather than every branch's: a union of a string
 * and an object that was given a number produces two complaints about one
 * field, and the reader has to work out which one they were supposed to satisfy.
 */
export function union<T extends readonly Schema<unknown>[]>(
  alternatives: T,
  message: string,
): Schema<Infer<T[number]>> {
  return {
    read: (value, path, issues) => {
      for (const alternative of alternatives) {
        const attempt: Issue[] = []
        const parsed = alternative.read(value, path, attempt)
        if (attempt.length === 0) return parsed as Infer<T[number]>
      }
      return fail(issues, path, message)
    },
  }
}

/**
 * A calendar date, `YYYY-MM-DD`.
 *
 * The shape and the date are both checked: `2026-13-45` matches the pattern and
 * is not a day, and a statement carrying it would print something nonsensical
 * or throw out of the formatter.
 */
export function isoDate(): Schema<string> {
  return {
    read: (value, path, issues) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return fail(issues, path, 'expected a date as YYYY-MM-DD')
      }
      const parsed = new Date(`${value}T00:00:00Z`)
      if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value)) {
        return fail(issues, path, `${value} is not a real date`)
      }
      return value
    },
  }
}

/** An ISO 8601 timestamp, as `new Date().toISOString()` writes one. */
export function isoDateTime(): Schema<string> {
  return {
    read: (value, path, issues) => {
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      ) {
        return fail(issues, path, 'expected an ISO 8601 timestamp')
      }
      if (Number.isNaN(new Date(value).getTime())) {
        return fail(issues, path, `${value} is not a real timestamp`)
      }
      return value
    },
  }
}

/** An absolute http or https URL. A statement links to it, so it has to work. */
export function url(): Schema<string> {
  return {
    read: (value, path, issues) => {
      if (typeof value !== 'string') return fail(issues, path, 'expected a URL')
      let parsed: URL
      try {
        parsed = new URL(value)
      } catch {
        return fail(issues, path, 'expected a URL, including https://')
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return fail(issues, path, 'expected an http or https URL')
      }
      return value
    },
  }
}

/**
 * An email address.
 *
 * Deliberately loose. The only address that is definitely deliverable is one
 * that has been delivered to, and a stricter pattern would reject valid
 * addresses — which, for the one field the EAA requires a provider to publish,
 * is the worse failure.
 */
export function email(): Schema<string> {
  return {
    read: (value, path, issues) => {
      if (typeof value !== 'string' || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value)) {
        return fail(issues, path, 'expected an email address')
      }
      return value
    },
  }
}
