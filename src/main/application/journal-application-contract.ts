import type {
  CompleteTodayResult,
  DailyEntry,
  DeviceSnapshotMetadata,
  HabitRecipe,
  JournalPreferences,
  SaveEntryInput,
  SaveEntryResult
} from '../../shared/journal-contract'
import type { JournalExportFormat } from '../export/journal-export'
import type {
  DurableWriter,
  KeyProtector,
  VaultFileOperations
} from '../storage/journal-vault-repository'

export interface FileDialogPort {
  savePortableBackup(suggestedName: string, data: Buffer): Promise<boolean>
  openPortableBackup(): Promise<Buffer | null>
  saveExport?(suggestedName: string, data: string): Promise<boolean>
}

export interface JournalApplicationOptions {
  dataDirectory: string
  clock: {
    now(): Date
    today(): string
  }
  keyProtector: KeyProtector
  durableWriter?: DurableWriter
  fileDialogs?: FileDialogPort
  vaultFileOperations?: VaultFileOperations
}

export const writingStarter = {
  question: 'What do you want to remember about today?',
  placeholder: 'Right now, I...'
} as const

export interface UnlockedApplicationView {
  access: 'unlocked'
  screen: 'welcome' | 'journal'
  today: string
  selectedDate: string
  selectedEntry: DailyEntry | null
  editable: boolean
  entryDates: string[]
  writingStarter: typeof writingStarter
  preferences: JournalPreferences
  habitRecipe: HabitRecipe | null
  pinEnabled: boolean
  pinReviewRequired: boolean
}

export interface LockedApplicationView {
  access: 'locked'
  screen: 'lock'
  today: string
  pinEnabled: true
}

export type JournalApplicationView = UnlockedApplicationView | LockedApplicationView

export interface JournalApplication {
  bootstrap(): Promise<JournalApplicationView>
  startWriting(): Promise<UnlockedApplicationView>
  openDate(date: string): Promise<UnlockedApplicationView>
  search(query: string): Promise<Array<{ date: string; title: string | null; snippet: string }>>
  listDeviceSnapshots(): Promise<DeviceSnapshotMetadata[]>
  createPortableBackup(input: {
    password: string
    confirmation: string
  }): Promise<{ status: 'saved' | 'cancelled' }>
  restorePortableBackup(input: { password: string }): Promise<
    | { status: 'cancelled' }
    | {
        status: 'restored'
        pinReviewRequired: true
        view: UnlockedApplicationView
      }
  >
  exportJournal(input: {
    format: JournalExportFormat
    unencryptedConfirmed: boolean
  }): Promise<{ status: 'saved' | 'cancelled' }>
  deleteEntry(date: string): Promise<{ deletedDate: string; entryDates: string[] }>
  restoreDeviceSnapshot(id: string): Promise<UnlockedApplicationView>
  configurePin(input: {
    pin: string
    confirmation: string
    currentPin?: string
  }): Promise<{ enabled: true }>
  disablePin(pin: string): Promise<{ enabled: false }>
  unlock(pin: string): Promise<UnlockedApplicationView>
  lock(): Promise<JournalApplicationView>
  clearForgottenPin(confirmation: string): Promise<UnlockedApplicationView>
  eraseJournalVault(input: { confirmation: string; pin?: string }): Promise<UnlockedApplicationView>
  updatePreferences(preferences: JournalPreferences): Promise<JournalPreferences>
  saveHabitRecipe(input: { anchor: string; enabled: boolean }): Promise<HabitRecipe>
  dismissHabitRecipeInvite(): Promise<{ dismissed: true }>
  setHabitRecipeEnabled(enabled: boolean): Promise<HabitRecipe>
  completeToday(): Promise<CompleteTodayResult>
  saveEntry(input: SaveEntryInput): Promise<SaveEntryResult>
}
