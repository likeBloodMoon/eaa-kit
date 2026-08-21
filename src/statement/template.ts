/**
 * A very small mustache-shaped template engine, just enough for the statement
 * templates. It exists so that every word of German legal prose lives in a .md
 * file rather than in TypeScript, including the wording that varies by
 * compliance status and by reason for a barrier.
 *
 * Supported:
 *   {{ path.to.value }}        interpolation
 *   {{#if path}} … {{/if}}     rendered when the value is truthy or a non-empty array
 *   {{#each path}} … {{/each}} rendered once per item, with the item as scope
 *   {{ . }}                    the current item inside an each block
 *
 * Blocks nest, and an inner block sees the scope of the block containing it,
 * which is what per-issue conditionals need.
 */

export type TemplateValue = unknown
export type TemplateScope = Record<string, TemplateValue>

export class TemplateError extends Error {
  override readonly name = 'TemplateError'
}

export function renderTemplate(template: string, scope: TemplateScope): string {
  return renderScope(stripStandaloneTags(template), [scope])
}

/**
 * A block tag alone on its line loses that line entirely, the way mustache
 * treats standalone tags. Without this, every conditional leaves a blank line
 * behind and a list item ends up separated from its own detail lines.
 */
function stripStandaloneTags(template: string): string {
  return template.replace(/^[ \t]*(\{\{[#/][^}]*\}\})[ \t]*\r?\n/gm, '$1')
}

/** Scopes are innermost-first; lookups walk outwards. */
type ScopeChain = TemplateValue[]

function renderScope(template: string, scopes: ScopeChain): string {
  let output = ''
  let index = 0

  while (index < template.length) {
    const open = template.indexOf('{{', index)
    if (open === -1) {
      output += template.slice(index)
      break
    }

    output += template.slice(index, open)
    const close = template.indexOf('}}', open)
    if (close === -1) {
      throw new TemplateError(`Unclosed tag at position ${open}`)
    }

    const tag = template.slice(open + 2, close).trim()

    if (tag.startsWith('#')) {
      const [kind, path] = splitBlockTag(tag)
      const body = findBlockBody(template, kind, close + 2)
      output += renderBlock(kind, path, body.content, scopes)
      index = body.end
      continue
    }

    if (tag.startsWith('/')) {
      throw new TemplateError(`Unexpected closing tag {{${tag}}}`)
    }

    output += stringify(lookup(tag, scopes))
    index = close + 2
  }

  return output
}

function splitBlockTag(tag: string): ['if' | 'each', string] {
  const match = /^#(if|each)\s+(\S+)$/.exec(tag)
  if (!match?.[1] || !match[2]) {
    throw new TemplateError(`Malformed block tag {{${tag}}}`)
  }
  return [match[1] as 'if' | 'each', match[2]]
}

/** Finds the matching close tag, counting nested blocks of the same kind. */
function findBlockBody(
  template: string,
  kind: string,
  from: number,
): { content: string; end: number } {
  const openTag = new RegExp(`\\{\\{#${kind}\\s`, 'g')
  const closeTag = new RegExp(`\\{\\{/${kind}\\}\\}`, 'g')
  let depth = 1
  let cursor = from

  while (depth > 0) {
    openTag.lastIndex = cursor
    closeTag.lastIndex = cursor
    const next = closeTag.exec(template)
    if (!next) {
      throw new TemplateError(`Missing {{/${kind}}}`)
    }
    const nested = openTag.exec(template)

    if (nested && nested.index < next.index) {
      depth += 1
      cursor = nested.index + nested[0].length
      continue
    }

    depth -= 1
    if (depth === 0) {
      return { content: template.slice(from, next.index), end: next.index + next[0].length }
    }
    cursor = next.index + next[0].length
  }

  throw new TemplateError(`Missing {{/${kind}}}`)
}

function renderBlock(kind: 'if' | 'each', path: string, body: string, scopes: ScopeChain): string {
  const value = lookup(path, scopes)

  if (kind === 'if') {
    return isTruthy(value) ? renderScope(body, scopes) : ''
  }

  if (!Array.isArray(value)) return ''
  return value.map((item) => renderScope(body, [item, ...scopes])).join('')
}

function isTruthy(value: TemplateValue): boolean {
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value)
}

function lookup(path: string, scopes: ScopeChain): TemplateValue {
  if (path === '.') return scopes[0]

  const segments = path.split('.')
  for (const scope of scopes) {
    const value = resolve(scope, segments)
    if (value !== undefined) return value
  }
  return undefined
}

function resolve(scope: TemplateValue, segments: string[]): TemplateValue {
  let current = scope
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, TemplateValue>)[segment]
    if (current === undefined) return undefined
  }
  return current
}

function stringify(value: TemplateValue): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringify).join(', ')
  return String(value)
}
