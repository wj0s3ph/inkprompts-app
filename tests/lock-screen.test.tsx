// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { LockScreen } from '../src/renderer/src/components/LockScreen'
import type { UnlockedView } from '../src/renderer/src/types'

const appInfo = {
  name: 'InkPrompts Journal',
  version: '1.0.0',
  copyright: 'Copyright © 2026 Chao Wang',
  privacySummary: 'Private and offline',
  license: 'MPL-2.0',
  sourceCodeUrl: 'https://github.com/wj0s3ph/inkprompts-app'
} as const

const restoredView: UnlockedView = {
  access: 'unlocked',
  screen: 'journal',
  today: '2026-08-11',
  selectedDate: '2026-08-11',
  selectedEntry: null,
  editable: true,
  entryDates: [],
  writingStarter: {
    question: 'What do you want to remember about today?',
    placeholder: 'Right now, I...'
  },
  preferences: { theme: 'system', spellcheck: true, idleLockMinutes: null },
  habitRecipe: null,
  pinEnabled: false,
  pinReviewRequired: true
}

afterEach(cleanup)

interface LockScreenHarness {
  clearForgottenPin: ReturnType<typeof vi.fn>
  onCleared: ReturnType<typeof vi.fn>
  onRestored: ReturnType<typeof vi.fn>
  restorePortableBackup: ReturnType<typeof vi.fn>
}

function renderLockScreen(options?: {
  restorePortableBackup?: ReturnType<typeof vi.fn>
}): LockScreenHarness {
  const onCleared = vi.fn()
  const onRestored = vi.fn()
  const clearForgottenPin = vi.fn(async () => restoredView)
  const restorePortableBackup =
    options?.restorePortableBackup ??
    vi.fn(async () => ({
      status: 'restored' as const,
      pinReviewRequired: true as const,
      view: restoredView
    }))
  const openExternalPage = vi.fn(async () => undefined)
  vi.spyOn(window, 'prompt').mockReturnValue(null)

  render(
    createElement(LockScreen, {
      appInfo,
      clearForgottenPin,
      onCleared,
      onRestored,
      onErasureFailed: () => undefined,
      onPendingDraftReleased: () => undefined,
      onUnlock: async () => restoredView,
      onUnlocked: () => undefined,
      openExternalPage,
      preparePortableBackupRestore: async (input) => {
        const result = await restorePortableBackup(input)
        return result.status === 'cancelled'
          ? result
          : { status: 'ready' as const, token: 'prepared-backup' }
      },
      commitPortableBackupRestore: async () => {
        const result = await restorePortableBackup.mock.results.at(-1)?.value
        if (!result || result.status !== 'restored') throw new Error('Restore was not prepared.')
        return result
      },
      protectPendingDraft: async () => 'saved' as const
    })
  )

  return { clearForgottenPin, onCleared, onRestored, restorePortableBackup }
}

describe('PIN recovery screen', () => {
  test('shows the packaged version with Privacy and Support available while locked', async () => {
    const user = userEvent.setup()
    renderLockScreen()

    expect(screen.getByText('Version 1.0.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Privacy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Support' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Privacy' }))
    await user.click(screen.getByRole('button', { name: 'Support' }))
  })

  test('offers backup restore, local erase, and a route back to PIN entry', async () => {
    const user = userEvent.setup()
    renderLockScreen()

    await user.click(screen.getByRole('button', { name: 'I forgot my PIN' }))

    expect(screen.getByRole('heading', { name: 'Can’t remember your PIN?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore Portable Backup' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Erase local data and start over' })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to PIN' }))
    expect(
      screen.getByRole('heading', { name: 'InkPrompts Journal is locked' })
    ).toBeInTheDocument()
  })

  test('restores a Portable Backup only after a backup password is entered', async () => {
    const user = userEvent.setup()
    const { onRestored, restorePortableBackup } = renderLockScreen()

    await user.click(screen.getByRole('button', { name: 'I forgot my PIN' }))
    await user.click(screen.getByRole('button', { name: 'Restore Portable Backup' }))

    expect(
      screen.getByText(/replaces the current Journal Vault and its Device Snapshots/i)
    ).toBeInTheDocument()
    const restore = screen.getByRole('button', { name: 'Choose Backup and Restore' })
    expect(restore).toBeDisabled()
    await user.type(screen.getByLabelText('Backup password'), 'independent recovery password')
    expect(restore).toBeEnabled()
    await user.click(restore)

    expect(restorePortableBackup).toHaveBeenCalledWith({
      password: 'independent recovery password'
    })
    expect(onRestored).toHaveBeenCalledWith(restoredView)
  })

  test('moves focus to a recovery failure so it is announced immediately', async () => {
    const user = userEvent.setup()
    renderLockScreen({
      restorePortableBackup: vi.fn(async () => {
        throw new Error('This Portable Backup is damaged and was not restored.')
      })
    })

    await user.click(screen.getByRole('button', { name: 'I forgot my PIN' }))
    await user.click(screen.getByRole('button', { name: 'Restore Portable Backup' }))
    await user.type(screen.getByLabelText('Backup password'), 'independent recovery password')
    await user.click(screen.getByRole('button', { name: 'Choose Backup and Restore' }))

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('This Portable Backup is damaged and was not restored.')
    expect(error).toHaveFocus()
  })

  test('requires the complete destructive phrase before erasing local journal data', async () => {
    const user = userEvent.setup()
    const { clearForgottenPin, onCleared } = renderLockScreen()

    await user.click(screen.getByRole('button', { name: 'I forgot my PIN' }))
    await user.click(screen.getByRole('button', { name: 'Erase local data and start over' }))

    expect(screen.getByText(/erases the App-managed Vault key/i)).toBeInTheDocument()
    expect(screen.getByText(/Markdown\/TXT\/JSON exports, Time Machine/i)).toBeInTheDocument()
    expect(screen.getByText(/not forensic disk overwriting/i)).toBeInTheDocument()
    const erase = screen.getByRole('button', { name: 'Erase Journal Vault' })
    expect(erase).toBeDisabled()
    await user.type(screen.getByLabelText(/Type DELETE MY JOURNAL VAULT to confirm/i), 'delete')
    expect(erase).toBeDisabled()
    await user.clear(screen.getByLabelText(/Type DELETE MY JOURNAL VAULT to confirm/i))
    await user.type(
      screen.getByLabelText(/Type DELETE MY JOURNAL VAULT to confirm/i),
      'DELETE MY JOURNAL VAULT'
    )
    await user.click(erase)

    expect(clearForgottenPin).toHaveBeenCalledWith('DELETE MY JOURNAL VAULT')
    expect(onCleared).toHaveBeenCalledWith(restoredView)
  })
})
