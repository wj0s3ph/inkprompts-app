import type { JournalApplication } from '../main/application/create-journal-application'
import type { AppInfo, ExternalPageId } from '../shared/product-info'
import type { IdleLockMinutes } from '../shared/journal-contract'

type PromisifiedCommands = {
  [Command in keyof JournalApplication]: JournalApplication[Command]
}

export interface JournalApi extends PromisifiedCommands {
  getAppInfo(): Promise<AppInfo>
  openExternalPage(page: ExternalPageId): Promise<void>
  requestLock(): void
  setIdleLock(preference: IdleLockMinutes | null): void
  reportActivity(): void
  pauseIdleLock(scope: string): void
  resumeIdleLock(scope: string): void
  onLocked(listener: (view: unknown) => void): () => void
  onLockRequested(listener: () => void): () => void
  onFlushRequested(listener: (intent: 'close' | 'quit') => Promise<boolean>): () => void
}

declare global {
  interface Window {
    journal: JournalApi
  }
}
