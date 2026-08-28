import { describe, expect, it } from 'vitest'
import * as s from '../src/schema.ts'

/** The parsed value, or the issues as `path: message` strings. */
function parse<T>(schema: s.Schema<T>, value: unknown): T | string[] {
  const result = s.safeParse(schema, value)
  return result.success
    ? result.data
    : result.error.issues.map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`)
}

describe('object', () => {
  const schema = s.object({ a: s.string(), b: s.optional(s.number()) })

  it('names a missing required field by its path', () => {
    expect(parse(schema, {})).toEqual(['a: is required'])
  })

  it('reports a nested path in full', () => {
    const nested = s.object({ provider: s.object({ email: s.email() }) })

    expect(parse(nested, { provider: { email: 'nope' } })).toEqual([
      'provider.email: expected an email address',
    ])
  })

  it('drops keys the schema does not name', () => {
    // A config must not smuggle fields the templates never asked for into a
    // legal document.
    expect(parse(schema, { a: 'x', sneaky: 'value' })).toEqual({ a: 'x' })
  })

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'does not read %s off Object.prototype',
    (key) => {
      // Every object appears to have these. Reading one would hand a function
      // back as a field value, which is how this class of bug reaches a report.
      expect(parse(s.object({ [key]: s.string() }), {})).toEqual([`${key}: is required`])
    },
  )

  it.each([
    ['an array', []],
    ['null', null],
    ['a string', 'x'],
  ])('rejects %s', (_name, value) => {
    expect(parse(schema, value)).toEqual(['document: expected an object'])
  })

  it('leaves an absent optional field out rather than setting it undefined', () => {
    expect(Object.hasOwn(parse(schema, { a: 'x' }) as object, 'b')).toBe(false)
  })

  it('still validates an optional field that is present', () => {
    expect(parse(schema, { a: 'x', b: 'not a number' })).toEqual(['b: expected a number'])
  })
})

describe('withDefault', () => {
  const schema = s.object({ list: s.withDefault(s.array(s.string()), () => []) })

  it('fills an absent field', () => {
    expect(parse(schema, {})).toEqual({ list: [] })
  })

  it('does not paper over a field that is present and wrong', () => {
    expect(parse(schema, { list: 'nope' })).toEqual(['list: expected an array'])
  })
})

describe('array', () => {
  it('reports the index of the element that failed', () => {
    const schema = s.array(s.object({ path: s.string() }))

    expect(parse(schema, [{ path: 'a' }, { path: 2 }])).toEqual(['1.path: expected a string'])
  })
})

describe('string', () => {
  it.each([
    [undefined, 'expected a string'],
    [42, 'expected a string'],
  ])('rejects %s', (value, message) => {
    expect(parse(s.string(), value)).toEqual([`document: ${message}`])
  })

  it('enforces a minimum length', () => {
    expect(parse(s.string({ min: 1 }), '')).toEqual(['document: must not be empty'])
  })
})

describe('enumeration', () => {
  it('lists the values it would have accepted', () => {
    expect(parse(s.enumeration(['a', 'b']), 'c')).toEqual(['document: expected one of a, b'])
  })
})

describe('isoDate', () => {
  it.each(['2026-08-28', '2000-01-01'])('accepts %s', (value) => {
    expect(parse(s.isoDate(), value)).toBe(value)
  })

  it.each(['28-08-2026', '2026-8-8', '', 'today'])('rejects the shape of %s', (value) => {
    expect(parse(s.isoDate(), value)).toEqual(['document: expected a date as YYYY-MM-DD'])
  })

  it.each(['2026-13-01', '2026-02-30', '2026-00-10'])('rejects %s, which is not a day', (value) => {
    // The shape is not enough: a statement carrying 2026-13-45 would print
    // something nonsensical or throw out of the formatter.
    expect(parse(s.isoDate(), value)).toEqual([`document: ${value} is not a real date`])
  })
})

describe('isoDateTime', () => {
  it('accepts what toISOString writes', () => {
    const now = new Date().toISOString()

    expect(parse(s.isoDateTime(), now)).toBe(now)
  })

  it.each(['2026-08-21', 'not-a-date', '', '2026-13-45T00:00:00Z'])('rejects %s', (value) => {
    expect(typeof parse(s.isoDateTime(), value)).not.toBe('string')
  })
})

describe('url', () => {
  it.each(['https://example.at', 'http://localhost:3000/x'])('accepts %s', (value) => {
    expect(parse(s.url(), value)).toBe(value)
  })

  it.each(['example.at', '', 'ftp://example.at', 'javascript:alert(1)'])('rejects %s', (value) => {
    expect(Array.isArray(parse(s.url(), value))).toBe(true)
  })
})

describe('email', () => {
  it.each(['office@example.at', 'a.b+c@sub.example.co.uk'])('accepts %s', (value) => {
    expect(parse(s.email(), value)).toBe(value)
  })

  it.each(['nope', '@example.at', 'a@b', 'a b@example.at'])('rejects %s', (value) => {
    expect(parse(s.email(), value)).toEqual(['document: expected an email address'])
  })
})

describe('union', () => {
  const schema = s.union([s.string(), s.number()], 'expected a string or a number')

  it.each([
    ['x', 'x'],
    [1, 1],
  ])('accepts %s', (value, expected) => {
    expect(parse(schema, value)).toBe(expected)
  })

  it('reports one message rather than one per branch', () => {
    // A union of three that fails should not produce three complaints about
    // one field, leaving the reader to work out which they had to satisfy.
    expect(parse(schema, true)).toEqual(['document: expected a string or a number'])
  })
})

describe('pipe', () => {
  it('widens a shorthand and validates the result as the full form', () => {
    const schema = s.pipe(
      s.transform(s.string(), (description) => ({ description })),
      s.object({ description: s.string({ min: 1 }) }),
    )

    expect(parse(schema, 'a barrier')).toEqual({ description: 'a barrier' })
    // The path is the field inside the widened form, which is where somebody
    // fixing it has to look — not the shorthand they happened to write.
    expect(parse(schema, '')).toEqual(['description: must not be empty'])
  })
})

describe('nullable', () => {
  const schema = s.nullable(s.string())

  it.each([
    [null, null],
    ['x', 'x'],
  ])('accepts %s', (value, expected) => {
    expect(parse(schema, value)).toBe(expected)
  })

  it('still rejects a wrong type', () => {
    expect(parse(schema, 5)).toEqual(['document: expected a string'])
  })
})

describe('record', () => {
  it('checks every value and names the key that failed', () => {
    const schema = s.record(s.object({ help: s.string() }))

    expect(parse(schema, { 'image-alt': { help: 1 } })).toEqual([
      'image-alt.help: expected a string',
    ])
  })
})
