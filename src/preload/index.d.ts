import type { JournalApplication } from '../main/application/create-journal-application'
import type { AppInfo, ExternalPageId } from '../shared/product-info'

type PromisifiedCommands = {
  [Command in keyof JournalApplication]: JournalApplication[Command]
}

export interface JournalApi extends PromisifiedCommands {
  getAppInfo(): Promise<AppInfo>
  openExternalPage(page: ExternalPageId): Promise<void>
  onLocked(listener: (view: unknown) => void): () => void
  onFlushRequested(listener: () => Promise<boolean>): () => void
}

declare global {
  interface Window {
    journal: JournalApi
  }
}
