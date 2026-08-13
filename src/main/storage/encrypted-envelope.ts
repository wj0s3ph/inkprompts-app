import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { JournalError } from '../journal-error'

const FORMAT = 'inkprompts-journal-vault'
const ENVELOPE_VERSION = 1
const ALGORITHM = 'aes-256-gcm'
const AAD = Buffer.from(`${FORMAT}:${ENVELOPE_VERSION}`)

interface EncryptedEnvelope {
  format: typeof FORMAT
  version: typeof ENVELOPE_VERSION
  algorithm: typeof ALGORITHM
  iv: string
  authenticationTag: string
  ciphertext: string
}

export function encryptEnvelope(plaintext: string, key: Uint8Array): string {
  assertKey(key)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(AAD)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  const envelope: EncryptedEnvelope = {
    format: FORMAT,
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString('base64'),
    authenticationTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }

  return JSON.stringify(envelope)
}

export function decryptEnvelope(serialized: string, key: Uint8Array): string {
  assertKey(key)
  const envelope = parseEnvelope(serialized)

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAAD(AAD)
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw vaultCorruptError()
  }
}

function parseEnvelope(serialized: string): EncryptedEnvelope {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw vaultCorruptError()
  }

  if (!value || typeof value !== 'object') throw vaultCorruptError()
  const envelope = value as Partial<EncryptedEnvelope>
  if (
    envelope.format !== FORMAT ||
    envelope.version !== ENVELOPE_VERSION ||
    envelope.algorithm !== ALGORITHM ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.authenticationTag !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw vaultCorruptError()
  }
  return envelope as EncryptedEnvelope
}

function assertKey(key: Uint8Array): void {
  if (key.byteLength !== 32) throw new Error('INVALID_VAULT_KEY')
}

function vaultCorruptError(): JournalError {
  return new JournalError(
    'VAULT_CORRUPT',
    'The Journal Vault is damaged or has been changed outside InkPrompts Journal.'
  )
}
