import { app, BrowserWindow, ipcMain, powerMonitor, session } from 'electron'
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
import packageMetadata from '../../package.json'

let mainWindow: BrowserWindow | null = null
let application: JournalApplication | null = null
let removeIpcHandlers: (() => void) | null = null
let closeApproved = false
let quitRequested = false

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
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

  application = createJournalApplication({
    dataDirectory: app.getPath('userData'),
    clock: { now: () => new Date(), today: localDateToday },
    keyProtector: new ElectronKeyProtector(),
    fileDialogs: new ElectronFileDialogs(window)
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

  window.on('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (closeApproved || window.webContents.isDestroyed()) return
    event.preventDefault()
    window.webContents.send('journal:flush-request')
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
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

async function lockForSystemLifecycle(): Promise<void> {
  if (!application || !mainWindow || mainWindow.isDestroyed()) return
  const view = await application.lock()
  if (view.access === 'locked') mainWindow.webContents.send('journal:locked', view)
}

app.setName('InkPrompts Journal')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.inkprompts.journal')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)

  ipcMain.on('journal:flush-complete', (event, success: unknown) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || success !== true) return
    closeApproved = true
    if (quitRequested) app.quit()
    else mainWindow.close()
  })

  powerMonitor.on('lock-screen', () => void lockForSystemLifecycle())
  powerMonitor.on('suspend', () => void lockForSystemLifecycle())
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && !closeApproved) {
    event.preventDefault()
    quitRequested = true
    mainWindow.webContents.send('journal:flush-request')
    return
  }
  removeIpcHandlers?.()
})
