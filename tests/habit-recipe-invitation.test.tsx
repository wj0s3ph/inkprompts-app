// @vitest-environment jsdom

import { createElement, useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { HabitRecipeInvitation } from '../src/renderer/src/components/HabitRecipeInvitation'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  })
})

afterEach(cleanup)

describe('Habit Recipe invitation', () => {
  test('moves focus into the modal and returns it to Done for Today after dismissal', async () => {
    const user = userEvent.setup()

    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(false)
      return createElement(
        'div',
        null,
        createElement('button', { type: 'button', onClick: () => setOpen(true) }, 'Done for Today'),
        open
          ? createElement(HabitRecipeInvitation, {
              onCreate: () => setOpen(false),
              onDismiss: () => setOpen(false)
            })
          : null
      )
    }

    render(createElement(Harness))
    const trigger = screen.getByRole('button', { name: 'Done for Today' })
    await user.click(trigger)

    expect(screen.getByRole('dialog', { name: 'Connect writing to your day?' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create a Habit Recipe' })).toHaveFocus()
    )
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
