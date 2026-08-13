import type { JournalApi } from '../../../../preload/index'
import type { UnlockedView } from '../../types'

export type RunSettingAction = (name: string, action: () => Promise<void>) => void

export interface CommonSettingsProps {
  api: JournalApi
  busy: string
  run: RunSettingAction
  view: UnlockedView
  refresh(): Promise<void>
  showMessage(message: string): void
}
