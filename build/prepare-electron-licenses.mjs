import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
require('electron')

const requiredFiles = [
  { path: 'node_modules/electron/LICENSE', minimumSize: 1_000 },
  {
    path: 'node_modules/electron/dist/LICENSES.chromium.html',
    minimumSize: 10_000_000
  }
]

for (const required of requiredFiles) {
  const size = (await stat(resolve(import.meta.dirname, '..', required.path))).size
  if (size <= required.minimumSize) {
    throw new Error(`${required.path} is missing or incomplete`)
  }
}
