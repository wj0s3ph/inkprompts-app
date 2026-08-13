import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { JournalError } from '../journal-error'

const FORMAT = 'inkprompts-portable-backup'
const VERSION = 1
const KDF = {
  name: 'scrypt',
  cost: 32768,
  blockSize: 8,
  parallelization: 1,
  keyLength: 32
} as const

interface PortableBackupEnvelope {
  format: typeof FORMAT
  version: typeof VERSION
  kdf: typeof KDF & { salt: string }
  encryption: {
    algorithm: 'aes-256-gcm'
    iv: string
    authenticationTag: string
    ciphertext: string
  }
}

export function encryptPortableBackup(serializedVault: string, password: string): Buffer {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const kdf = { ...KDF, salt: salt.toString('base64') }
  const aad = backupAad(kdf)
  const key = deriveKey(password, salt, kdf)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(serializedVault, 'utf8'), cipher.final()])
  const envelope: PortableBackupEnvelope = {
    format: FORMAT,
    version: VERSION,
    kdf,
    encryption: {
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      authenticationTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
  }
  key.fill(0)
  return Buffer.from(JSON.stringify(envelope))
}

export function decryptPortableBackup(data: Buffer, password: string): string {
  if (data.byteLength > 100 * 1024 * 1024) throw damagedBackupError()

  let envelope: Partial<PortableBackupEnvelope>
  try {
    envelope = JSON.parse(data.toString('utf8')) as Partial<PortableBackupEnvelope>
  } catch {
    throw damagedBackupError()
  }
  if (envelope.format !== FORMAT || typeof envelope.version !== 'number') {
    throw damagedBackupError()
  }
  if (envelope.version !== VERSION) {
    throw new JournalError(
      'BACKUP_INVALID',
      'This Portable Backup was created by an unsupported version.'
    )
  }
  try {
    assertEnvelope(envelope)
  } catch {
    throw damagedBackupError()
  }

  let key: Buffer | undefined
  try {
    const salt = Buffer.from(envelope.kdf.salt, 'base64')
    key = deriveKey(password, salt, envelope.kdf)
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.encryption.iv, 'base64')
    )
    decipher.setAAD(backupAad(envelope.kdf))
    decipher.setAuthTag(Buffer.from(envelope.encryption.authenticationTag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.encryption.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')
    return plaintext
  } catch {
    throw new JournalError(
      'BACKUP_INVALID',
      'The backup password is incorrect, or this Portable Backup is damaged.'
    )
  } finally {
    key?.fill(0)
  }
}

function damagedBackupError(): JournalError {
  return new JournalError('BACKUP_INVALID', 'This Portable Backup is damaged and was not restored.')
}

function assertEnvelope(
  envelope: Partial<PortableBackupEnvelope>
): asserts envelope is PortableBackupEnvelope {
  if (
    envelope.format !== FORMAT ||
    envelope.version !== VERSION ||
    envelope.kdf?.name !== KDF.name ||
    envelope.kdf.cost !== KDF.cost ||
    envelope.kdf.blockSize !== KDF.blockSize ||
    envelope.kdf.parallelization !== KDF.parallelization ||
    envelope.kdf.keyLength !== KDF.keyLength ||
    typeof envelope.kdf.salt !== 'string' ||
    envelope.encryption?.algorithm !== 'aes-256-gcm' ||
    typeof envelope.encryption.iv !== 'string' ||
    typeof envelope.encryption.authenticationTag !== 'string' ||
    typeof envelope.encryption.ciphertext !== 'string'
  ) {
    throw new Error('invalid backup')
  }
}

function deriveKey(password: string, salt: Uint8Array, kdf: PortableBackupEnvelope['kdf']): Buffer {
  return scryptSync(password, salt, kdf.keyLength, {
    N: kdf.cost,
    r: kdf.blockSize,
    p: kdf.parallelization,
    maxmem: 64 * 1024 * 1024
  })
}

function backupAad(kdf: PortableBackupEnvelope['kdf']): Buffer {
  return Buffer.from(JSON.stringify({ format: FORMAT, version: VERSION, kdf }))
}
