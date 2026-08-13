const { listPackage } = require('@electron/asar')

const requiredEntries = [
  '/out/main/index.js',
  '/out/preload/index.js',
  '/out/renderer/index.html',
  '/package.json',
  '/resources/icon.png',
  '/node_modules/@electron-toolkit/utils/package.json',
  '/node_modules/signal-exit/package.json',
  '/node_modules/write-file-atomic/package.json'
]

const allowedContainerEntries = [
  '/node_modules',
  '/node_modules/@electron-toolkit',
  '/out',
  '/out/main',
  '/out/preload',
  '/out/renderer',
  '/out/renderer/assets',
  '/resources'
]

const allowedTreeEntries = [
  '/node_modules/@electron-toolkit/utils',
  '/node_modules/signal-exit',
  '/node_modules/write-file-atomic'
]

const allowedFileEntries = new Set(requiredEntries)
const allowedRendererAsset = /^\/out\/renderer\/assets\/[^/]+\.(?:css|js)$/

function normalizeEntry(entry) {
  const normalized = entry.replaceAll('\\', '/')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function isAllowed(entry) {
  return (
    allowedContainerEntries.includes(entry) ||
    allowedFileEntries.has(entry) ||
    allowedRendererAsset.test(entry) ||
    allowedTreeEntries.some((allowed) => entry === allowed || entry.startsWith(`${allowed}/`))
  )
}

function assertPackagedApplicationEntries(entries) {
  const normalizedEntries = new Set(entries.map(normalizeEntry))
  const unexpected = [...normalizedEntries].filter((entry) => !isAllowed(entry))
  if (unexpected.length > 0) {
    throw new Error(`Release package contains unexpected entry: ${unexpected.sort()[0]}`)
  }

  const missing = requiredEntries.filter((entry) => !normalizedEntries.has(entry))
  if (missing.length > 0) {
    throw new Error(`Release package is missing required entry: ${missing[0]}`)
  }
}

async function assertPackagedApplicationFiles(archivePath) {
  assertPackagedApplicationEntries(listPackage(archivePath))
}

module.exports = { assertPackagedApplicationEntries, assertPackagedApplicationFiles }
