import { app, BrowserWindow, ipcMain, powerMonitor, screen, session } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  createJournalApplication,
  type JournalApplication
} from './application/create-journal-application'
import { registerJournalIpc } from './ipc/register-journal-ipc'
import { ElectronFileDialogs } from './platform/electron-file-dialogs'
import { ElectronKeyProtector } from './platform/electron-key-protector'
import {
  loadWindowState,
  visibleWindowBounds,
  WindowStateController
} from './platform/window-state'
import packageMetadata from '../../package.json'
import { IdleLockCoordinator } from './application/idle-lock-coordinator'
import type { IdleLockMinutes } from '../shared/journal-contract'
import type { DurableWriter } from './storage/journal-vault-repository'
import writeFileAtomic from 'write-file-atomic'

let mainWindow: BrowserWindow | null = null
let application: JournalApplication | null = null
let removeIpcHandlers: (() => void) | null = null
let closeApproved = false
let quitRequested = false
let windowStateController: WindowStateController | null = null
let lockRequest: Promise<void> | null = null
let idleLockCoordinator: IdleLockCoordinator<ReturnType<typeof setTimeout>> | null = null
let nextLockToken = 0
const lockPreparations = new Map<number, () => void>()

async function createWindow(): Promise<void> {
  const dataDirectory = app.getPath('userData')
  const storedWindowState = await loadWindowState(dataDirectory)
  const restoredBounds = storedWindowState
    ? visibleWindowBounds(
        storedWindowState.bounds,
        screen.getAllDisplays(),
        screen.getPrimaryDisplay(),
        { width: 720, height: 560 }
      )
    : null
  const window = new BrowserWindow({
    ...(restoredBounds ?? { width: 1180, height: 760 }),
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: 'InkPrompts Journal',
    backgroundColor: '#f4f6fa',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: is.dev
    }
  })
  mainWindow = window
  closeApproved = false
  windowStateController = new WindowStateController(window, dataDirectory, {
    version: 1,
    bounds: restoredBounds ?? window.getNormalBounds(),
    maximized: storedWindowState?.maximized ?? false
  })
  idleLockCoordinator?.dispose()
  idleLockCoordinator = new IdleLockCoordinator(
    {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (handle) => clearTimeout(handle)
    },
    lockForSystemLifecycle,
    process.env['INKPROMPTS_IDLE_LOCK_TEST_MS']
      ? () => Number(process.env['INKPROMPTS_IDLE_LOCK_TEST_MS'])
      : undefined
  )

  application = createJournalApplication({
    dataDirectory,
    clock: { now: () => new Date(), today: localDateToday },
    keyProtector: new ElectronKeyProtector(),
    fileDialogs: new ElectronFileDialogs(window, idleLockCoordinator),
    durableWriter: delayedTestWriter()
  })
  removeIpcHandlers?.()
  removeIpcHandlers = registerJournalIpc(application, () => mainWindow, {
    name: 'InkPrompts Journal',
    version: packageMetadata.version,
    copyright: 'Copyright © 2026 Chao Wang',
    privacySummary: 'Private and offline',
    license: 'MPL-2.0',
    sourceCodeUrl: 'https://github.com/wj0s3ph/inkprompts-app'
  })

  window.on('ready-to-show', () => {
    if (storedWindowState?.maximized) window.maximize()
    window.show()
  })
  window.on('close', (event) => {
    if (closeApproved || window.webContents.isDestroyed()) return
    event.preventDefault()
    window.webContents.send('journal:flush-request', quitRequested ? 'quit' : 'close')
  })
  window.on('closed', () => {
    if (mainWindow === window) {
      windowStateController?.dispose()
      windowStateController = null
      idleLockCoordinator?.dispose()
      idleLockCoordinator = null
      mainWindow = null
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function localDateToday(): string {
  const value = new Date()
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function prepareRendererForLock(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const token = ++nextLockToken
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      lockPreparations.delete(token)
      resolve()
    }, 250)
    lockPreparations.set(token, () => {
      clearTimeout(timer)
      resolve()
    })
    mainWindow!.webContents.send('journal:prepare-lock', token)
  })
}

async function lockForSystemLifecycle(): Promise<void> {
  if (!application || !mainWindow || mainWindow.isDestroyed()) return
  if (lockRequest) return lockRequest
  idleLockCoordinator?.setLocked()
  lockRequest = (async () => {
    await prepareRendererForLock()
    if (!application || !mainWindow || mainWindow.isDestroyed()) return
    const view = await application.lock()
    if (view.access === 'locked') mainWindow.webContents.send('journal:locked', view)
    else idleLockCoordinator?.setUnlocked()
  })().finally(() => {
    lockRequest = null
  })
  return lockRequest
}

app.setName('InkPrompts Journal')

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.inkprompts.journal')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)

  ipcMain.on('journal:flush-complete', async (event, success: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    if (success !== true) {
      quitRequested = false
      return
    }
    await Promise.race([
      windowStateController?.flush().catch(() => undefined) ?? Promise.resolve(),
      new Promise<void>((resolve) => setTimeout(resolve, 250))
    ])
    closeApproved = true
    if (quitRequested) app.quit()
    else mainWindow.close()
  })
  ipcMain.on('journal:request-lock', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    void lockForSystemLifecycle()
  })
  ipcMain.on('journal:lock-prepared', (event, token: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || typeof token !== 'number') return
    const resolve = lockPreparations.get(token)
    if (!resolve) return
    lockPreparations.delete(token)
    resolve()
  })
  ipcMain.on('journal:set-idle-lock', (event, preference: unknown) => {
    if (!isTrustedRenderer(event.sender)) return
    if (![null, 'off', 5, 15, 30, 60].includes(preference as string | number | null)) return
    idleLockCoordinator?.setPreference(preference as IdleLockMinutes | null)
    idleLockCoordinator?.setUnlocked()
  })
  ipcMain.on('journal:activity', (event) => {
    if (!isTrustedRenderer(event.sender)) return
    idleLockCoordinator?.recordActivity('click')
  })
  ipcMain.on('journal:pause-idle-lock', (event, scope: unknown) => {
    if (!isTrustedRenderer(event.sender) || typeof scope !== 'string' || scope.length > 100) return
    idleLockCoordinator?.pause(`renderer:${scope}`)
  })
  ipcMain.on('journal:resume-idle-lock', (event, scope: unknown) => {
    if (!isTrustedRenderer(event.sender) || typeof scope !== 'string' || scope.length > 100) return
    idleLockCoordinator?.resume(`renderer:${scope}`)
  })

  powerMonitor.on('lock-screen', () => void lockForSystemLifecycle())
  powerMonitor.on('suspend', () => void lockForSystemLifecycle())
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && !closeApproved) {
    event.preventDefault()
    quitRequested = true
    mainWindow.webContents.send('journal:flush-request', 'quit')
    return
  }
  removeIpcHandlers?.()
})

function isTrustedRenderer(sender: Electron.WebContents): boolean {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents)
}

function delayedTestWriter(): DurableWriter | undefined {
  const configuredDelay = process.env['INKPROMPTS_DURABLE_WRITE_TEST_MS']
  if (!configuredDelay) return undefined
  const delay = Number(configuredDelay)
  if (!Number.isFinite(delay) || delay <= 0) {
    throw new Error('INKPROMPTS_DURABLE_WRITE_TEST_MS must be a positive number.')
  }
  return {
    async write(path, data) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
      await writeFileAtomic(path, data, { encoding: 'utf8', fsync: true, mode: 0o600 })
    }
  }
}
