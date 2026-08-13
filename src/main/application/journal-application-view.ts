import { JournalError } from '../journal-error'
import type { JournalVaultState } from '../storage/journal-vault-repository'
import {
  writingStarter,
  type LockedApplicationView,
  type UnlockedApplicationView
} from './journal-application-contract'

export function buildView(
  state: JournalVaultState,
  today: string,
  screen: 'welcome' | 'journal',
  selectedDate = today
): UnlockedApplicationView {
  const selectedEntry = Object.hasOwn(state.entries, selectedDate)
    ? state.entries[selectedDate]
    : null
  return {
    access: 'unlocked',
    screen,
    today,
    selectedDate,
    selectedEntry,
    editable: selectedDate <= today,
    entryDates: entryDates(state),
    writingStarter,
    preferences: state.preferences,
    habitRecipe: state.habitRecipe,
    pinEnabled: Boolean(state.pinLock),
    pinReviewRequired: state.pinReviewRequired
  }
}

export function buildLockView(today: string): LockedApplicationView {
  return {
    access: 'locked',
    screen: 'lock',
    today,
    pinEnabled: true
  }
}

export function entryDates(state: JournalVaultState): string[] {
  return Object.keys(state.entries).sort()
}

export function assertEditableDate(date: string, today: string): void {
  assertLocalDate(date)
  if (date > today) throw new JournalError('INVALID_INPUT', 'Future dates are read-only.')
}

export function assertLocalDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRealDate(date)) {
    throw new JournalError('INVALID_INPUT', 'Choose a valid local calendar date.')
  }
}

function isRealDate(date: string): boolean {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  )
}
