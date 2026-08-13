import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as plist from 'plist'
import { afterEach, describe, expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const { createPackage } = require('@electron/asar') as {
  createPackage: (source: string, destination: string) => Promise<void>
}
const afterPack = require('../build/after-pack.cjs') as (context: {
  appOutDir: string
  electronPlatformName: string
  packager: { appInfo: { productFilename: string } }
}) => Promise<void>
const directories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'inkprompts-after-pack-'))
  directories.push(directory)
  return directory
}

async function writeValidApplicationArchive(resources: string): Promise<void> {
  const source = join(resources, '..', 'asar-source')
  const files = new Map([
    ['out/main/index.js', ''],
    ['out/preload/index.js', ''],
    ['out/renderer/index.html', ''],
    ['package.json', '{}'],
    ['resources/icon.png', ''],
    ['node_modules/@electron-toolkit/utils/package.json', '{}'],
    ['node_modules/signal-exit/package.json', '{}'],
    ['node_modules/write-file-atomic/package.json', '{}']
  ])

  for (const [relativePath, contents] of files) {
    const path = join(source, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }

  await createPackage(source, join(resources, 'app.asar'))
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('after-pack release sanitation', () => {
  test.each([
    ['win32', 'resources'],
    ['linux', 'resources']
  ])('removes updater metadata from %s packages', async (platform, resourcesName) => {
    const appOutDir = await temporaryDirectory()
    const resources = join(appOutDir, resourcesName)
    await mkdir(resources, { recursive: true })
    await writeFile(join(resources, 'app-update.yml'), 'provider: github')
    await writeFile(join(resources, 'PrivacyInfo.xcprivacy'), '<plist/>')
    await writeValidApplicationArchive(resources)

    await afterPack({
      appOutDir,
      electronPlatformName: platform,
      packager: { appInfo: { productFilename: 'InkPrompts Journal' } }
    })

    await expect(readFile(join(resources, 'app-update.yml'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  test.each(['darwin', 'mas'])(
    'sanitizes %s macOS bundles and removes updater metadata',
    async (electronPlatformName) => {
      const appOutDir = await temporaryDirectory()
      const contents = join(appOutDir, 'InkPrompts Journal.app', 'Contents')
      const resources = join(contents, 'Resources')
      await mkdir(resources, { recursive: true })
      await writeFile(join(resources, 'app-update.yml'), 'provider: github')
      await writeFile(join(resources, 'PrivacyInfo.xcprivacy'), '<plist/>')
      await writeValidApplicationArchive(resources)
      await writeFile(
        join(contents, 'Info.plist'),
        plist.build({
          CFBundleIdentifier: 'com.inkprompts.journal',
          NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
          NSCameraUsageDescription: 'unused',
          NSMicrophoneUsageDescription: 'unused'
        })
      )

      await afterPack({
        appOutDir,
        electronPlatformName,
        packager: { appInfo: { productFilename: 'InkPrompts Journal' } }
      })

      const info = plist.parse(await readFile(join(contents, 'Info.plist'), 'utf8'))
      expect(info).toEqual({ CFBundleIdentifier: 'com.inkprompts.journal' })
      await expect(readFile(join(resources, 'app-update.yml'))).rejects.toMatchObject({
        code: 'ENOENT'
      })
    }
  )

  test('fails fast when an expected package structure is missing or malformed', async () => {
    const missing = await temporaryDirectory()
    await expect(
      afterPack({
        appOutDir: missing,
        electronPlatformName: 'linux',
        packager: { appInfo: { productFilename: 'InkPrompts Journal' } }
      })
    ).rejects.toThrow()

    const malformed = await temporaryDirectory()
    const contents = join(malformed, 'InkPrompts Journal.app', 'Contents')
    await mkdir(join(contents, 'Resources'), { recursive: true })
    await writeFile(join(contents, 'Resources', 'PrivacyInfo.xcprivacy'), '<plist/>')
    await writeFile(join(contents, 'Info.plist'), 'not a plist')
    await expect(
      afterPack({
        appOutDir: malformed,
        electronPlatformName: 'darwin',
        packager: { appInfo: { productFilename: 'InkPrompts Journal' } }
      })
    ).rejects.toThrow()
  })
})
