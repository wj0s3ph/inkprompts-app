import { contextBridge, ipcRenderer } from 'electron'
import type { JournalApi } from './index.d'
import type { JournalIpcResult } from '../main/ipc/register-journal-ipc'

export type { JournalApi } from './index.d'

const invoke = async <T>(command: string, ...args: unknown[]): Promise<T> => {
  const result = (await ipcRenderer.invoke(`journal:${command}`, ...args)) as JournalIpcResult
  if (result.ok) return result.value as T
  return Promise.reject({ name: 'JournalError', ...result.error })
}

let flushPending: (intent: 'close' | 'quit') => Promise<boolean> = async () => true
let prepareLock: () => void = () => undefined

ipcRenderer.on('journal:flush-request', async (_event, value: unknown) => {
  let success = false
  try {
    success = await flushPending(value === 'quit' ? 'quit' : 'close')
  } finally {
    ipcRenderer.send('journal:flush-complete', success)
  }
})

ipcRenderer.on('journal:prepare-lock', (_event, token: unknown) => {
  try {
    prepareLock()
  } finally {
    ipcRenderer.send('journal:lock-prepared', token)
  }
})

const journal: JournalApi = {
  bootstrap: () => invoke('bootstrap'),
  startWriting: () => invoke('startWriting'),
  openDate: (date) => invoke('openDate', date),
  listJournalHistory: () => invoke('listJournalHistory'),
  search: (query) => invoke('search', query),
  listDeviceSnapshots: () => invoke('listDeviceSnapshots'),
  createPortableBackup: (input) => invoke('createPortableBackup', input),
  restorePortableBackup: (input) => invoke('restorePortableBackup', input),
  preparePortableBackupRestore: (input) => invoke('preparePortableBackupRestore', input),
  commitPortableBackupRestore: (token) => invoke('commitPortableBackupRestore', token),
  exportJournal: (input) => invoke('exportJournal', input),
  deleteEntry: (date) => invoke('deleteEntry', date),
  restoreDeviceSnapshot: (id) => invoke('restoreDeviceSnapshot', id),
  prepareDeviceSnapshotRestore: (id) => invoke('prepareDeviceSnapshotRestore', id),
  commitDeviceSnapshotRestore: (token) => invoke('commitDeviceSnapshotRestore', token),
  configurePin: (input) => invoke('configurePin', input),
  disablePin: (pin) => invoke('disablePin', pin),
  unlock: (pin) => invoke('unlock', pin),
  lock: () => invoke('lock'),
  clearForgottenPin: (confirmation) => invoke('clearForgottenPin', confirmation),
  eraseJournalVault: (input) => invoke('eraseJournalVault', input),
  updatePreferences: (preferences) => invoke('updatePreferences', preferences),
  saveHabitRecipe: (input) => invoke('saveHabitRecipe', input),
  dismissHabitRecipeInvite: () => invoke('dismissHabitRecipeInvite'),
  setHabitRecipeEnabled: (enabled) => invoke('setHabitRecipeEnabled', enabled),
  completeToday: () => invoke('completeToday'),
  saveEntry: (input) => invoke('saveEntry', input),
  getAppInfo: () => invoke('getAppInfo'),
  openExternalPage: (page) => invoke('openExternalPage', page),
  requestLock: () => ipcRenderer.send('journal:request-lock'),
  setIdleLock: (preference) => ipcRenderer.send('journal:set-idle-lock', preference),
  reportActivity: () => ipcRenderer.send('journal:activity'),
  pauseIdleLock: (scope) => ipcRenderer.send('journal:pause-idle-lock', scope),
  resumeIdleLock: (scope) => ipcRenderer.send('journal:resume-idle-lock', scope),
  onLocked(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => listener(value)
    ipcRenderer.on('journal:locked', handler)
    return () => ipcRenderer.removeListener('journal:locked', handler)
  },
  onLockRequested(listener) {
    prepareLock = listener
    return () => {
      if (prepareLock === listener) prepareLock = () => undefined
    }
  },
  onFlushRequested(listener) {
    flushPending = listener
    return () => {
      if (flushPending === listener) flushPending = async () => true
    }
  }
}

contextBridge.exposeInMainWorld('journal', journal)
