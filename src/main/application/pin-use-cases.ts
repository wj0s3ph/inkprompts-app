import { JournalError } from '../journal-error'
import { createPinLock, isSixDigitPin, verifyPin } from '../security/pin-lock'
import type { JournalApplication } from './journal-application-contract'
import { buildLockView, buildView } from './journal-application-view'
import type { JournalSession } from './journal-session'

type PinUseCases = Pick<
  JournalApplication,
  'configurePin' | 'disablePin' | 'unlock' | 'lock' | 'clearForgottenPin'
>

export function createPinUseCases(session: JournalSession): PinUseCases {
  let failedAttempts = 0
  let retryAt = 0

  return {
    async configurePin(input: { pin: string; confirmation: string; currentPin?: string }) {
      if (!isSixDigitPin(input.pin) || input.pin !== input.confirmation) {
        throw new JournalError(
          'INVALID_INPUT',
          'PIN Lock requires the same 6-digit PIN in both fields.'
        )
      }
      return session.commit((current) => {
        if (
          current.pinLock &&
          (!input.currentPin || !verifyPin(input.currentPin, current.pinLock))
        ) {
          throw new JournalError('INVALID_PIN', 'Enter the current PIN before changing it.')
        }
        const pinLock = createPinLock(
          input.pin,
          session.clock.now().toISOString(),
          current.pinLock ?? undefined
        )
        return {
          state: {
            ...current,
            pinLock,
            pinReviewRequired: false,
            preferences: {
              ...current.preferences,
              idleLockMinutes: current.pinLock ? current.preferences.idleLockMinutes : 15
            }
          },
          result: { enabled: true as const }
        }
      })
    },

    async disablePin(pin: string) {
      return session.commit((current) => {
        if (!current.pinLock || !isSixDigitPin(pin) || !verifyPin(pin, current.pinLock)) {
          throw new JournalError('INVALID_PIN', 'Enter the current PIN before disabling PIN Lock.')
        }
        return {
          state: {
            ...current,
            pinLock: null,
            preferences: { ...current.preferences, idleLockMinutes: null }
          },
          result: { enabled: false as const }
        }
      })
    },

    async unlock(pin: string) {
      const state = await session.getSettledState()
      if (!state.pinLock) {
        session.unlock()
        return buildView(state, session.clock.today(), 'journal')
      }
      const now = session.clock.now().getTime()
      if (now < retryAt) {
        throw new JournalError(
          'PIN_RETRY_DELAY',
          'Wait before trying the PIN again.',
          retryAt - now
        )
      }
      if (!isSixDigitPin(pin) || !verifyPin(pin, state.pinLock)) {
        failedAttempts += 1
        const delay = failedAttempts < 2 ? 0 : Math.min(30_000, 2 ** (failedAttempts - 2) * 1_000)
        retryAt = now + delay
        throw new JournalError('INVALID_PIN', 'That PIN did not match.')
      }
      failedAttempts = 0
      retryAt = 0
      session.unlock()
      return buildView(state, session.clock.today(), 'journal')
    },

    async lock() {
      const state = await session.getSettledState()
      if (!state.pinLock) return buildView(state, session.clock.today(), 'journal')
      session.lock()
      return buildLockView(session.clock.today())
    },

    async clearForgottenPin(confirmation) {
      if (confirmation !== 'DELETE MY JOURNAL VAULT') {
        throw new JournalError(
          'INVALID_INPUT',
          'Type DELETE MY JOURNAL VAULT exactly to clear local journal data.'
        )
      }
      const state = await session.eraseVault(false, (current) => {
        if (session.isUnlocked()) {
          throw new JournalError(
            'INVALID_INPUT',
            'Forgotten PIN erasure is available only while InkPrompts Journal is locked.'
          )
        }
        if (!current.pinLock) throw new JournalError('INVALID_INPUT', 'PIN Lock is not enabled.')
      })
      failedAttempts = 0
      retryAt = 0
      return buildView(state, session.clock.today(), 'welcome')
    }
  }
}
