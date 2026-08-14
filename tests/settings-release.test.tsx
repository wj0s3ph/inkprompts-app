// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { JournalApi } from '../src/preload/index'
import { SettingsDialog } from '../src/renderer/src/components/SettingsDialog'
import { AboutSettings } from '../src/renderer/src/components/settings/AboutSettings'
import { VaultErasureSettings } from '../src/renderer/src/components/settings/VaultErasureSettings'
import type { UnlockedView } from '../src/renderer/src/types'

const view = {
  access: 'unlocked',
  screen: 'journal',
  today: '2026-08-13',
  selectedDate: '2026-08-13',
  selectedEntry: null,
  editable: true,
  entryDates: [],
  writingStarter: {
    question: 'What do you want to remember about today?',
    placeholder: 'Right now, I...'
  },
  preferences: { theme: 'system', spellcheck: true, idleLockMinutes: 15 },
  habitRecipe: null,
  pinEnabled: true,
  pinReviewRequired: false
} satisfies UnlockedView

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  })
})

afterEach(cleanup)

describe('release Settings', () => {
  test('moves focus to a Settings action error so assistive technology announces it', async () => {
    const user = userEvent.setup()
    const api = {
      listDeviceSnapshots: vi.fn(async () => []),
      updatePreferences: vi.fn(async () => {
        throw new Error('Preferences could not be saved.')
      })
    } as unknown as JournalApi

    render(
      createElement(SettingsDialog, {
        api,
        appInfo: {
          name: 'InkPrompts Journal',
          version: '1.0.0',
          copyright: 'Copyright © 2026 Chao Wang',
          privacySummary: 'Private and offline',
          license: 'MPL-2.0',
          sourceCodeUrl: 'https://github.com/wj0s3ph/inkprompts-app'
        },
        flushPending: async () => true,
        onClose: () => undefined,
        onErasureFailed: () => undefined,
        onPendingDraftReleased: () => undefined,
        onRestore: () => undefined,
        onViewChange: () => undefined,
        open: true,
        protectPendingDraft: async () => 'saved',
        view
      })
    )

    await user.selectOptions(screen.getByLabelText('Theme'), 'dark')
    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Preferences could not be saved.')
    await waitFor(() => expect(error).toHaveFocus())
  })

  test('About shows only the packaged version', () => {
    render(
      createElement(AboutSettings, {
        version: '1.0.0'
      })
    )

    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByText('Version 1.0.0')).toBeInTheDocument()
    expect(screen.queryByText('InkPrompts Journal')).not.toBeInTheDocument()
    expect(screen.queryByText('Private and offline')).not.toBeInTheDocument()
    expect(screen.queryByText('Open source under MPL-2.0')).not.toBeInTheDocument()
    expect(screen.queryByText('https://github.com/wj0s3ph/inkprompts-app')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  test('can explicitly authorize discarding an unsavable draft before erasure', async () => {
    const user = userEvent.setup()
    const protectPendingDraft = vi.fn(async () => 'discard-authorized' as const)
    const createPortableBackup = vi.fn()
    const eraseJournalVault = vi.fn(async () => ({ screen: 'welcome' }))
    const onErased = vi.fn()
    const api = { createPortableBackup, eraseJournalVault } as unknown as JournalApi

    render(
      createElement(VaultErasureSettings, {
        api,
        busy: '',
        onErased,
        onErasureFailed: () => undefined,
        onPendingDraftReleased: () => undefined,
        protectPendingDraft,
        run: (_name, action) => void action(),
        view
      })
    )

    expect(screen.getByText(/Time Machine and APFS system snapshots/i)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Erase without creating a backup' }))
    await user.click(screen.getByLabelText(/I understand unsaved writing will be destroyed/i))
    await user.type(screen.getByLabelText('Current PIN'), '123456')
    await user.type(screen.getByLabelText(/Type ERASE to confirm/i), 'ERASE')
    await user.click(screen.getByRole('button', { name: 'Erase Journal Vault' }))

    await waitFor(() => expect(eraseJournalVault).toHaveBeenCalled())
    expect(protectPendingDraft).toHaveBeenCalledWith({ action: 'erase the Journal Vault' })
    expect(createPortableBackup).not.toHaveBeenCalled()
    expect(eraseJournalVault).toHaveBeenCalledWith({ confirmation: 'ERASE', pin: '123456' })
    expect(onErased).toHaveBeenCalled()
  })

  test('finishes a durable Portable Backup before beginning erasure', async () => {
    const user = userEvent.setup()
    const order: string[] = []
    const api = {
      async createPortableBackup() {
        order.push('backup')
        return { status: 'saved' as const }
      },
      async eraseJournalVault() {
        order.push('erase')
        return { screen: 'welcome' }
      }
    } as unknown as JournalApi

    render(
      createElement(VaultErasureSettings, {
        api,
        busy: '',
        protectPendingDraft: async () => {
          order.push('save')
          return 'saved'
        },
        onErased: () => undefined,
        onErasureFailed: () => undefined,
        onPendingDraftReleased: () => undefined,
        run: (_name, action) => void action(),
        view
      })
    )

    await user.type(screen.getByLabelText('Erasure backup password'), 'portable backup password')
    await user.type(
      screen.getByLabelText('Confirm erasure backup password'),
      'portable backup password'
    )
    await user.type(screen.getByLabelText('Current PIN'), '123456')
    await user.type(screen.getByLabelText(/Type ERASE to confirm/i), 'ERASE')
    await user.click(screen.getByRole('button', { name: 'Back Up and Erase Journal Vault' }))

    await waitFor(() => expect(order).toEqual(['save', 'backup', 'erase']))
  })

  test('closes access to rendered journal data when erasure fails', async () => {
    const user = userEvent.setup()
    const failure = Object.assign(
      new Error(
        'Journal Vault Erasure did not finish. InkPrompts will continue safely on next launch.'
      ),
      { code: 'SAVE_FAILED' }
    )
    const onErasureFailed = vi.fn()
    const api = {
      createPortableBackup: vi.fn(),
      eraseJournalVault: vi.fn(async () => {
        throw failure
      })
    } as unknown as JournalApi

    render(
      createElement(VaultErasureSettings, {
        api,
        busy: '',
        onErased: () => undefined,
        onErasureFailed,
        onPendingDraftReleased: () => undefined,
        protectPendingDraft: async () => 'saved',
        run: (_name, action) => void action().catch(() => undefined),
        view
      })
    )

    await user.click(screen.getByRole('radio', { name: 'Erase without creating a backup' }))
    await user.click(screen.getByLabelText(/I understand unsaved writing will be destroyed/i))
    await user.type(screen.getByLabelText('Current PIN'), '123456')
    await user.type(screen.getByLabelText(/Type ERASE to confirm/i), 'ERASE')
    await user.click(screen.getByRole('button', { name: 'Erase Journal Vault' }))

    await waitFor(() => expect(onErasureFailed).toHaveBeenCalledWith(failure))
  })

  test('keeps Settings available when erasure validation rejects the current PIN', async () => {
    const user = userEvent.setup()
    const onErasureFailed = vi.fn()
    const api = {
      createPortableBackup: vi.fn(),
      eraseJournalVault: vi.fn(async () => {
        throw Object.assign(new Error('Enter the current PIN before erasing the vault.'), {
          code: 'INVALID_PIN'
        })
      })
    } as unknown as JournalApi

    render(
      createElement(VaultErasureSettings, {
        api,
        busy: '',
        onErased: () => undefined,
        onErasureFailed,
        onPendingDraftReleased: () => undefined,
        protectPendingDraft: async () => 'saved',
        run: (_name, action) => void action().catch(() => undefined),
        view
      })
    )

    await user.click(screen.getByRole('radio', { name: 'Erase without creating a backup' }))
    await user.click(screen.getByLabelText(/I understand unsaved writing will be destroyed/i))
    await user.type(screen.getByLabelText('Current PIN'), '000000')
    await user.type(screen.getByLabelText(/Type ERASE to confirm/i), 'ERASE')
    await user.click(screen.getByRole('button', { name: 'Erase Journal Vault' }))

    await waitFor(() => expect(api.eraseJournalVault).toHaveBeenCalled())
    expect(onErasureFailed).not.toHaveBeenCalled()
  })
})
