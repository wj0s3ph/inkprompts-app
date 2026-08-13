import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { JournalApplication } from '../application/create-journal-application'
import { JournalError } from '../journal-error'
import type { AppInfo } from '../../shared/product-info'
import { assertExternalPageIpcArguments, EXTERNAL_PAGE_URLS } from './external-pages'
import { assertJournalIpcArguments } from './journal-ipc-validation'

export const JOURNAL_CHANNEL_PREFIX = 'journal:'

const commandNames = [
  'bootstrap',
  'startWriting',
  'openDate',
  'search',
  'listDeviceSnapshots',
  'createPortableBackup',
  'restorePortableBackup',
  'exportJournal',
  'deleteEntry',
  'restoreDeviceSnapshot',
  'configurePin',
  'disablePin',
  'unlock',
  'lock',
  'clearForgottenPin',
  'eraseJournalVault',
  'updatePreferences',
  'saveHabitRecipe',
  'dismissHabitRecipeInvite',
  'setHabitRecipeEnabled',
  'completeToday',
  'saveEntry'
] as const satisfies readonly (keyof JournalApplication)[]

interface IpcSuccess {
  ok: true
  value: unknown
}

interface IpcFailure {
  ok: false
  error: { code: string; message: string; retryAfterMs?: number }
}

export type JournalIpcResult = IpcSuccess | IpcFailure

export function registerJournalIpc(
  application: JournalApplication,
  getWindow: () => BrowserWindow | null,
  appInfo: AppInfo
): () => void {
  for (const command of commandNames) {
    ipcMain.handle(`${JOURNAL_CHANNEL_PREFIX}${command}`, async (event, ...args) => {
      assertTrustedSender(event, getWindow())
      try {
        assertJournalIpcArguments(command, args)
        const method = application[command] as (...parameters: unknown[]) => Promise<unknown>
        return { ok: true, value: await method(...args) } satisfies JournalIpcResult
      } catch (error) {
        return { ok: false, error: serializeError(error) } satisfies JournalIpcResult
      }
    })
  }

  ipcMain.handle(`${JOURNAL_CHANNEL_PREFIX}getAppInfo`, async (event, ...args) => {
    assertTrustedSender(event, getWindow())
    if (args.length !== 0) {
      return {
        ok: false,
        error: serializeError(
          new JournalError('INVALID_INPUT', 'The renderer request had an invalid shape.')
        )
      } satisfies JournalIpcResult
    }
    return { ok: true, value: appInfo } satisfies JournalIpcResult
  })

  ipcMain.handle(`${JOURNAL_CHANNEL_PREFIX}openExternalPage`, async (event, ...args) => {
    assertTrustedSender(event, getWindow())
    try {
      assertExternalPageIpcArguments(args)
      await shell.openExternal(EXTERNAL_PAGE_URLS[args[0]])
      return { ok: true, value: undefined } satisfies JournalIpcResult
    } catch (error) {
      return { ok: false, error: serializeError(error) } satisfies JournalIpcResult
    }
  })

  return () => {
    for (const command of commandNames) ipcMain.removeHandler(`${JOURNAL_CHANNEL_PREFIX}${command}`)
    ipcMain.removeHandler(`${JOURNAL_CHANNEL_PREFIX}getAppInfo`)
    ipcMain.removeHandler(`${JOURNAL_CHANNEL_PREFIX}openExternalPage`)
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): void {
  if (
    !window ||
    event.sender !== window.webContents ||
    !event.senderFrame ||
    event.senderFrame !== event.senderFrame.top
  ) {
    throw new JournalError('INVALID_INPUT', 'Untrusted renderer request.')
  }
}

function serializeError(error: unknown): IpcFailure['error'] {
  if (error instanceof JournalError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs })
    }
  }
  return {
    code: 'UNEXPECTED_ERROR',
    message: 'An unexpected error occurred. No journal data was changed.'
  }
}
