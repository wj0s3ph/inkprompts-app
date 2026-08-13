import { JournalError } from '../journal-error'
import { verifyPin } from '../security/pin-lock'
import type { JournalApplication } from './journal-application-contract'
import { buildView } from './journal-application-view'
import type { JournalSession } from './journal-session'

type VaultErasureUseCases = Pick<JournalApplication, 'eraseJournalVault'>

export function createVaultErasureUseCases(session: JournalSession): VaultErasureUseCases {
  return {
    async eraseJournalVault(input) {
      if (input.confirmation !== 'ERASE') {
        throw new JournalError('INVALID_INPUT', 'Type ERASE exactly to erase the Journal Vault.')
      }
      const state = await session.eraseVault(true, (state) => {
        if (state.pinLock && (!input.pin || !verifyPin(input.pin, state.pinLock))) {
          throw new JournalError('INVALID_PIN', 'Enter the current PIN before erasing the vault.')
        }
      })
      return buildView(state, session.clock.today(), 'welcome')
    }
  }
}
