import { createDailyEntryUseCases } from './daily-entry-use-cases'
import { createHabitPreferenceUseCases } from './habit-preference-use-cases'
import type { JournalApplication, JournalApplicationOptions } from './journal-application-contract'
import { createPinUseCases } from './pin-use-cases'
import { createRecoveryUseCases } from './recovery-use-cases'
import { JournalSession } from './journal-session'
import { createVaultErasureUseCases } from './vault-erasure-use-cases'

export type {
  FileDialogPort,
  JournalApplication,
  JournalApplicationOptions,
  JournalApplicationView,
  LockedApplicationView,
  UnlockedApplicationView
} from './journal-application-contract'

export function createJournalApplication(options: JournalApplicationOptions): JournalApplication {
  const session = new JournalSession(options)
  return {
    ...createDailyEntryUseCases(session),
    ...createRecoveryUseCases(session),
    ...createPinUseCases(session),
    ...createVaultErasureUseCases(session),
    ...createHabitPreferenceUseCases(session)
  }
}
