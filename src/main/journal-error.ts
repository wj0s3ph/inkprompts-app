export type JournalErrorCode =
  | 'VAULT_CORRUPT'
  | 'VAULT_UNSUPPORTED'
  | 'SYSTEM_KEY_UNAVAILABLE'
  | 'SAVE_FAILED'
  | 'ERASURE_NOT_STARTED'
  | 'INVALID_INPUT'
  | 'LOCKED'
  | 'INVALID_PIN'
  | 'PIN_RETRY_DELAY'
  | 'BACKUP_INVALID'

export class JournalError extends Error {
  constructor(
    readonly code: JournalErrorCode,
    message: string = code,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'JournalError'
  }
}
