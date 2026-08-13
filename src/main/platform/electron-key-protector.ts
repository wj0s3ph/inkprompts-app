import { safeStorage } from 'electron'
import type { KeyProtector } from '../storage/journal-vault-repository'
import { JournalError } from '../journal-error'

export class ElectronKeyProtector implements KeyProtector {
  assertAvailable(): void {
    const insecureLinuxBackend =
      process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'
    if (!safeStorage.isEncryptionAvailable() || insecureLinuxBackend) {
      throw new JournalError(
        'SYSTEM_KEY_UNAVAILABLE',
        'Secure system storage is unavailable. InkPrompts Journal will not create a plaintext vault.'
      )
    }
  }

  protect(key: Uint8Array): string {
    this.assertAvailable()
    return safeStorage.encryptString(Buffer.from(key).toString('base64')).toString('base64')
  }

  unprotect(value: string): Uint8Array {
    this.assertAvailable()
    try {
      return Buffer.from(safeStorage.decryptString(Buffer.from(value, 'base64')), 'base64')
    } catch {
      throw new JournalError(
        'SYSTEM_KEY_UNAVAILABLE',
        'The system could not unlock this Journal Vault key.'
      )
    }
  }
}
