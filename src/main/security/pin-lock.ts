import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export interface PinLockRecord {
  salt: string
  hash: string
  createdAt: string
  updatedAt: string
}

export function createPinLock(
  pin: string,
  timestamp: string,
  previous?: PinLockRecord
): PinLockRecord {
  const salt = randomBytes(16)
  return {
    salt: salt.toString('base64'),
    hash: derivePin(pin, salt).toString('base64'),
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp
  }
}

export function verifyPin(pin: string, record: PinLockRecord): boolean {
  const expected = Buffer.from(record.hash, 'base64')
  const actual = derivePin(pin, Buffer.from(record.salt, 'base64'))
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual)
}

export function isSixDigitPin(value: string): boolean {
  return /^\d{6}$/.test(value)
}

function derivePin(pin: string, salt: Uint8Array): Buffer {
  return scryptSync(pin, salt, 32)
}
