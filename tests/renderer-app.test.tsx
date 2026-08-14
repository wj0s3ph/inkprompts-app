// @vitest-environment jsdom

import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { JournalApi } from '../src/preload/index'
import App from '../src/renderer/src/App'
import { firstDayForLocale } from '../src/renderer/src/calendar-week-start'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'journal')
})

describe('InkPrompts Journal renderer', () => {
  test.each([
    ['en-US', 0],
    ['en-GB', 1],
    ['ar-AF', 1]
  ] as const)('maps the %s system region to the supported week start', (language, firstDay) => {
    expect(firstDayForLocale(language)).toBe(firstDay)
  })

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

  test('conceals the workspace as soon as lock preparation begins', async () => {
    let prepareLock = (): void => undefined
    let resolveSave: (value: unknown) => void = () => undefined
    const save = new Promise((resolve) => {
      resolveSave = resolve
    })
    const api = {
      bootstrap: vi.fn().mockResolvedValue({
        access: 'unlocked',
        screen: 'journal',
        today: '2026-08-14',
        selectedDate: '2026-08-14',
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
      }),
      getAppInfo: vi.fn().mockResolvedValue({
        name: 'InkPrompts Journal',
        version: '1.0.0',
        copyright: 'Copyright',
        privacySummary: 'Private and offline',
        license: 'MPL-2.0',
        sourceCodeUrl: 'https://example.com'
      }),
      listJournalHistory: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([]),
      setIdleLock: vi.fn(),
      reportActivity: vi.fn(),
      pauseIdleLock: vi.fn(),
      resumeIdleLock: vi.fn(),
      onLocked: vi.fn(() => () => undefined),
      onLockRequested: vi.fn((listener: () => void) => {
        prepareLock = listener
        return () => undefined
      }),
      onFlushRequested: vi.fn(() => () => undefined),
      openExternalPage: vi.fn(),
      saveEntry: vi.fn(() => save)
    } as unknown as JournalApi
    Object.defineProperty(window, 'journal', { configurable: true, value: api })

    render(createElement(App))
    await screen.findByRole('textbox', { name: 'Daily Entry body' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Optional title' }), {
      target: { value: 'Write still in progress' }
    })
    await waitFor(() => expect(api.saveEntry).toHaveBeenCalledOnce())

    document.dispatchEvent(new Event('click', { bubbles: true }))
    expect(api.reportActivity).not.toHaveBeenCalled()

    act(() => prepareLock())

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'InkPrompts Journal is locked' })
      ).toBeInTheDocument()
    )
    expect(screen.queryByRole('textbox', { name: 'Daily Entry body' })).not.toBeInTheDocument()

    await act(async () => {
      resolveSave({
        status: 'saved',
        entry: null,
        entryDates: []
      })
      await save
    })
  })
})
