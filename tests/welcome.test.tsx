// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Welcome } from '../src/renderer/src/components/Welcome'

afterEach(cleanup)

describe('Welcome', () => {
  test('starts writing, exposes trusted public pages, and restores without creating first', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    const onRestore = vi.fn(async () => ({ status: 'cancelled' as const }))
    const openExternalPage = vi.fn(async () => undefined)
    render(
      createElement(Welcome, {
        busy: false,
        onStart,
        onRestore,
        openExternalPage
      })
    )

    await user.click(screen.getByRole('button', { name: 'Website' }))
    await user.click(screen.getByRole('button', { name: 'Privacy' }))
    expect(openExternalPage.mock.calls).toEqual([['website'], ['privacy']])

    await user.click(screen.getByRole('button', { name: 'Restore a Portable Backup' }))
    const password = screen.getByLabelText('Backup password')
    expect(password).toHaveFocus()
    await user.type(password, 'portable recovery password')
    await user.click(screen.getByRole('button', { name: 'Choose Backup and Restore' }))

    expect(onRestore).toHaveBeenCalledWith({ password: 'portable recovery password' })
    expect(screen.getByRole('status')).toHaveTextContent(
      'No backup was selected. No Journal Vault was created.'
    )
    expect(onStart).not.toHaveBeenCalled()
  })

  test('announces restore failures while keeping the recovery form available', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn(async () => {
      throw new Error('This Portable Backup is damaged or unsupported.')
    })
    render(
      createElement(Welcome, {
        busy: false,
        onStart: () => undefined,
        onRestore,
        openExternalPage: async () => undefined
      })
    )

    await user.click(screen.getByRole('button', { name: 'Restore a Portable Backup' }))
    await user.type(screen.getByLabelText('Backup password'), 'portable recovery password')
    await user.click(screen.getByRole('button', { name: 'Choose Backup and Restore' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This Portable Backup is damaged or unsupported.'
    )
    await waitFor(() => expect(screen.getByLabelText('Backup password')).toHaveFocus())
  })
})
