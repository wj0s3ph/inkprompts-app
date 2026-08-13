import type { JournalApi } from '../../preload/index'

export type ApplicationView = Awaited<ReturnType<JournalApi['bootstrap']>>
export type UnlockedView = Extract<ApplicationView, { access: 'unlocked' }>
export type LockedView = Extract<ApplicationView, { access: 'locked' }>
export type SearchResult = Awaited<ReturnType<JournalApi['search']>>[number]
export type DeviceSnapshot = Awaited<ReturnType<JournalApi['listDeviceSnapshots']>>[number]

export interface JournalApiError {
  name: 'JournalError'
  message: string
  code: string
  retryAfterMs?: number
}
