const { access, readFile, rm, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { assertPackagedApplicationFiles } = require('./package-contents.cjs')

const unusedMacPermissions = [
  'NSAppTransportSecurity',
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription'
]

module.exports = async function afterPack(context) {
  const isMac = ['darwin', 'mas'].includes(context.electronPlatformName)
  const contentsDirectory = isMac
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents')
    : context.appOutDir
  const resourcesDirectory = join(contentsDirectory, isMac ? 'Resources' : 'resources')

  await access(resourcesDirectory)
  await assertPackagedApplicationFiles(join(resourcesDirectory, 'app.asar'))
  const updateFile = join(resourcesDirectory, 'app-update.yml')
  await rm(updateFile, { force: true })
  await assertMissing(updateFile)

  if (!isMac) return

  const plist = await import('plist')
  const infoPath = join(contentsDirectory, 'Info.plist')
  const info = plist.parse(await readFile(infoPath, 'utf8'))
  for (const key of unusedMacPermissions) delete info[key]
  await writeFile(infoPath, plist.build(info))
  await access(join(resourcesDirectory, 'PrivacyInfo.xcprivacy'))
}

async function assertMissing(path) {
  try {
    await access(path)
  } catch (error) {
    if (error && error.code === 'ENOENT') return
    throw error
  }
  throw new Error(`Release package still contains ${path}`)
}
