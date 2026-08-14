import { dialog, type BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import writeFileAtomic from 'write-file-atomic'
import type { FileDialogPort } from '../application/create-journal-application'

export class ElectronFileDialogs implements FileDialogPort {
  constructor(
    private readonly window: BrowserWindow,
    private readonly idleLock: { pause(scope: string): void; resume(scope: string): void }
  ) {}

  async savePortableBackup(suggestedName: string, data: Buffer): Promise<boolean> {
    const result = await this.withPausedTimer('portable-backup-save', () =>
      dialog.showSaveDialog(this.window, {
        title: 'Create Portable Backup',
        defaultPath: suggestedName,
        filters: [{ name: 'InkPrompts Portable Backup', extensions: ['inkbackup'] }]
      })
    )
    if (result.canceled || !result.filePath) return false
    await writeFileAtomic(result.filePath, data, { fsync: true, mode: 0o600 })
    return true
  }

  async openPortableBackup(): Promise<Buffer | null> {
    const result = await this.withPausedTimer('portable-backup-open', () =>
      dialog.showOpenDialog(this.window, {
        title: 'Restore Portable Backup',
        properties: ['openFile'],
        filters: [{ name: 'InkPrompts Portable Backup', extensions: ['inkbackup'] }]
      })
    )
    if (result.canceled || result.filePaths.length !== 1) return null
    return readFile(result.filePaths[0])
  }

  async saveExport(suggestedName: string, data: string): Promise<boolean> {
    const extension = suggestedName.split('.').pop() ?? 'txt'
    const result = await this.withPausedTimer('journal-export-save', () =>
      dialog.showSaveDialog(this.window, {
        title: 'Save unencrypted journal export',
        defaultPath: suggestedName,
        filters: [{ name: `${extension.toUpperCase()} export`, extensions: [extension] }]
      })
    )
    if (result.canceled || !result.filePath) return false
    await writeFileAtomic(result.filePath, data, { encoding: 'utf8', fsync: true, mode: 0o600 })
    return true
  }

  private async withPausedTimer<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    this.idleLock.pause(scope)
    try {
      return await operation()
    } finally {
      this.idleLock.resume(scope)
    }
  }
}
