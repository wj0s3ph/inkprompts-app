import { describe, expect, test } from 'vitest'
import { assertJournalIpcArguments } from '../src/main/ipc/journal-ipc-validation'
import { assertExternalPageIpcArguments } from '../src/main/ipc/external-pages'

const content = {
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A sentence.' }] }]
}

describe('journal IPC input boundary', () => {
  test('accepts the documented argument shape for a business command', () => {
    expect(() =>
      assertJournalIpcArguments('saveEntry', [{ date: '2026-08-11', title: '', content }])
    ).not.toThrow()
  })

  test.each([
    ['startWriting', [true]],
    ['openDate', ['2026-08-11', 'unexpected']],
    ['saveEntry', [null]],
    ['updatePreferences', [{ theme: 'dark', spellcheck: true, extra: true }]],
    ['setHabitRecipeEnabled', ['yes']]
  ] as const)('rejects malformed %s arguments before dispatch', (command, args) => {
    expect(() => assertJournalIpcArguments(command, args)).toThrowError(
      'The renderer request had an invalid shape.'
    )
  })

  test('accepts one trusted page identifier and rejects extra or malformed input', () => {
    expect(() => assertExternalPageIpcArguments(['privacy'])).not.toThrow()
    expect(() => assertExternalPageIpcArguments(['privacy', 'extra'])).toThrowError(
      'The renderer request had an invalid shape.'
    )
    expect(() => assertExternalPageIpcArguments(['https://inkprompts.com/privacy'])).toThrowError(
      'Choose one of the available InkPrompts pages.'
    )
  })
})
