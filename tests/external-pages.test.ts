import { describe, expect, test } from 'vitest'
import { EXTERNAL_PAGE_URLS, assertExternalPageId } from '../src/main/ipc/external-pages'

describe('trusted external page contract', () => {
  test('maps only the four public page identifiers in the main process', () => {
    expect(EXTERNAL_PAGE_URLS).toEqual({
      website: 'https://inkprompts.com/journal',
      privacy: 'https://inkprompts.com/privacy',
      terms: 'https://inkprompts.com/terms',
      support: 'https://inkprompts.com/contact'
    })
  })

  test.each([
    'https://inkprompts.com/privacy',
    'privacy?next=example.com',
    'github',
    '',
    42,
    null,
    { page: 'privacy' }
  ])('rejects arbitrary external page input: %j', (value) => {
    expect(() => assertExternalPageId(value)).toThrowError(
      'Choose one of the available InkPrompts pages.'
    )
  })
})
