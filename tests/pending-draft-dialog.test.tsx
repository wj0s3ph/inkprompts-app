// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { PendingDraftDialog } from '../src/renderer/src/components/PendingDraftDialog'

afterEach(cleanup)

describe('Pending Draft decision', () => {
  test('names the draft and requires an explicit discard action', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onDiscard = vi.fn()
    const onSaved = vi.fn()
    const trySave = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    render(
      createElement(PendingDraftDialog, {
        action: 'close InkPrompts Journal',
        concealDetails: false,
        date: '2026-08-11',
        trySave,
        onCancel,
        onDiscard,
        onSaved,
        pauseIdleLock: () => undefined,
        resumeIdleLock: () => undefined
      })
    )

    expect(screen.getByRole('dialog')).toHaveTextContent('August 11, 2026')
    expect(screen.getByRole('button', { name: 'Discard Draft and Continue' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('still could not be saved')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onSaved).toHaveBeenCalledOnce()
  })

  test('conceals all draft details while locked', () => {
    render(
      createElement(PendingDraftDialog, {
        action: 'restore a Portable Backup',
        concealDetails: true,
        date: '2026-08-11',
        trySave: null,
        onCancel: () => undefined,
        onDiscard: () => undefined,
        onSaved: () => undefined,
        pauseIdleLock: () => undefined,
        resumeIdleLock: () => undefined
      })
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('unsaved writing')
    expect(dialog).not.toHaveTextContent('August')
    expect(dialog).not.toHaveTextContent('2026')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })
})
