// @vitest-environment jsdom

import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import App from '../src/renderer/src/App'

describe('InkPrompts Journal renderer', () => {
  test('first launch explains local privacy and offers one Start writing action', () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { process: { versions: {} } }
    })
    render(createElement(App))

    expect(screen.getByRole('heading', { name: 'InkPrompts Journal' })).toBeInTheDocument()
    expect(screen.getByText(/stays encrypted on this device/i)).toBeInTheDocument()
    expect(screen.getByText(/PIN Lock is optional/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start writing' })).toBeInTheDocument()
  })
})
