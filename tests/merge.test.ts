import { describe, expect, it } from 'vitest'
import { analyze, buildScope, firstName, lastName, render, sampleContact } from '../src/server/lib/merge.js'

describe('merge tags', () => {
  const contact = { id: 7, email: 'ahsan.rahman@northwind.example', name: 'Ahsan Rahman', fields: { company: 'Northwind', plan: 'Pro' } }
  const ctx = { contact, campaign: { name: 'Onboarding' }, unsubscribeUrl: 'https://app.test/t/u/abc' }

  it('substitutes variables and ignores whitespace', () => {
    expect(render('Hi {{first_name}} {{ last_name }}!', ctx)).toBe('Hi Ahsan Rahman!')
  })

  it('falls back when a value is missing', () => {
    expect(render('Hi {{ first_name | friend }}', { contact: { email: 'someone@x.example', name: '' } })).toBe('Hi someone')
    expect(render('{{ nickname | there }}', ctx)).toBe('there')
  })

  it('derives a usable first name from the email local part', () => {
    expect(firstName({ email: 'jon.doe@example.com' })).toBe('jon doe')
    expect(lastName({ name: 'Mary Ann Smith' })).toBe('Ann Smith')
  })

  it('exposes custom fields both bare and namespaced', () => {
    expect(render('{{ company }} / {{ fields.plan }}', ctx)).toBe('Northwind / Pro')
  })

  it('supports conditional blocks', () => {
    expect(render('{{#if company}}Pro account: {{plan}}{{/if}}', ctx)).toBe('Pro account: Pro')
    expect(render('{{#if missing}}shown{{else}}hidden{{/if}}', ctx)).toContain('hidden')
    expect(render('{{#unless nickname}}no nickname set{{/unless}}', ctx)).toBe('no nickname set')
  })

  it('leaves real variables alone but flags unknown ones', () => {
    const result = analyze('Hi {{ first_name }} from {{ conpany }}', ctx)
    expect(result.used).toContain('first_name')
    expect(result.unknown).toEqual(['conpany'])
  })

  it('renders dates deterministically for a fixed clock', () => {
    const rendered = render('{{ date }} · {{ year }}', { ...ctx, now: new Date('2026-03-05T10:00:00.000Z') })
    expect(rendered).toBe('March 5, 2026 · 2026')
  })

  it('builds a scope that always includes the built-ins', () => {
    const scope = buildScope({ contact: sampleContact() })
    expect(scope.email).toContain('@')
    expect(scope.first_name).toBe('Ahsan')
    expect(scope.company).toBe('Northwind')
  })
})
