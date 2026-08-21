import { describe, expect, it } from 'vitest'
import { renderTemplate, TemplateError } from '../../src/statement/template.ts'

describe('interpolation', () => {
  it('substitutes a value', () => {
    expect(renderTemplate('Hallo {{ name }}.', { name: 'Welt' })).toBe('Hallo Welt.')
  })

  it('walks a dotted path', () => {
    expect(renderTemplate('{{ site.url }}', { site: { url: 'https://example.at' } })).toBe(
      'https://example.at',
    )
  })

  it('renders a missing value as nothing rather than "undefined"', () => {
    expect(renderTemplate('[{{ provider.phone }}]', { provider: {} })).toBe('[]')
  })

  it('joins arrays with commas', () => {
    expect(renderTemplate('{{ criteria }}', { criteria: ['1.4.3', '2.5.8'] })).toBe('1.4.3, 2.5.8')
  })
})

describe('if blocks', () => {
  it('renders when truthy', () => {
    expect(renderTemplate('{{#if ok}}ja{{/if}}', { ok: true })).toBe('ja')
  })

  it('skips when falsy', () => {
    expect(renderTemplate('{{#if ok}}ja{{/if}}', { ok: false })).toBe('')
  })

  it('treats an empty array as falsy and a filled one as truthy', () => {
    expect(renderTemplate('{{#if items}}x{{/if}}', { items: [] })).toBe('')
    expect(renderTemplate('{{#if items}}x{{/if}}', { items: [1] })).toBe('x')
  })

  it('treats an empty string as falsy, so optional fields disappear', () => {
    expect(renderTemplate('{{#if remedyBy}}bis {{ remedyBy }}{{/if}}', { remedyBy: '' })).toBe('')
  })
})

describe('each blocks', () => {
  it('renders once per item with the item in scope', () => {
    const output = renderTemplate('{{#each issues}}- {{ description }}\n{{/each}}', {
      issues: [{ description: 'eins' }, { description: 'zwei' }],
    })

    expect(output).toBe('- eins\n- zwei\n')
  })

  it('gives an inner if the item scope, not the outer one', () => {
    // The case that matters: each issue decides its own reason line.
    const output = renderTemplate(
      '{{#each issues}}{{ name }}{{#if planned}} (geplant){{/if}}\n{{/each}}',
      {
        planned: false,
        issues: [
          { name: 'eins', planned: true },
          { name: 'zwei', planned: false },
        ],
      },
    )

    expect(output).toBe('eins (geplant)\nzwei\n')
  })

  it('falls back to the outer scope for values the item does not have', () => {
    const output = renderTemplate('{{#each items}}{{ label }}:{{ name }} {{/each}}', {
      label: 'Punkt',
      items: [{ name: 'a' }, { name: 'b' }],
    })

    expect(output).toBe('Punkt:a Punkt:b ')
  })

  it('renders nothing when the value is not an array', () => {
    expect(renderTemplate('{{#each items}}x{{/each}}', { items: undefined })).toBe('')
  })

  it('supports {{ . }} for a list of plain strings', () => {
    expect(renderTemplate('{{#each items}}[{{ . }}]{{/each}}', { items: ['a', 'b'] })).toBe(
      '[a][b]',
    )
  })

  it('nests each inside each', () => {
    const output = renderTemplate('{{#each groups}}{{#each items}}{{ . }}{{/each}}|{{/each}}', {
      groups: [{ items: ['a', 'b'] }, { items: ['c'] }],
    })

    expect(output).toBe('ab|c|')
  })
})

describe('standalone tags', () => {
  it('removes the line a block tag sits on', () => {
    // Without this every conditional leaves a blank line, which in markdown
    // turns a list item and its detail lines into separate paragraphs.
    const template = ['- {{ name }}', '{{#if detail}}', '  {{ detail }}', '{{/if}}', ''].join('\n')

    expect(renderTemplate(template, { name: 'eins', detail: 'zwei' })).toBe('- eins\n  zwei\n')
  })

  it('leaves interpolation on its own line alone', () => {
    expect(renderTemplate('{{ a }}\n{{ b }}\n', { a: '1', b: '2' })).toBe('1\n2\n')
  })
})

describe('malformed templates', () => {
  it('rejects an unclosed tag', () => {
    expect(() => renderTemplate('{{ name', {})).toThrow(TemplateError)
  })

  it('rejects a block that is never closed', () => {
    expect(() => renderTemplate('{{#if a}}x', { a: true })).toThrow(/Missing \{\{\/if\}\}/)
  })

  it('rejects a stray closing tag', () => {
    expect(() => renderTemplate('x{{/if}}', {})).toThrow(TemplateError)
  })

  it('rejects an unknown block type', () => {
    expect(() => renderTemplate('{{#unless a}}x{{/unless}}', {})).toThrow(/Malformed block tag/)
  })
})
