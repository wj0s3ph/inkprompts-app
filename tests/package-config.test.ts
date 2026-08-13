import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as plist from 'plist'
import { describe, expect, test } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)

function runDevelopmentPackager(
  args: string[],
  environment: NodeJS.ProcessEnv = {}
): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(process.execPath, ['build/package-development.mjs', ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...environment }
    })
    let stderr = ''
    let stdout = ''

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on('error', rejectProcess)
    child.on('close', (exitCode) => resolveProcess({ exitCode, stderr, stdout }))
  })
}

function runLicenseCheck(
  auditDirectory: string
): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(process.execPath, ['build/generate-third-party-notices.mjs', '--check'], {
      cwd: projectRoot,
      env: { ...process.env, INKPROMPTS_LICENSE_AUDIT_DIR: auditDirectory }
    })
    let stderr = ''
    let stdout = ''

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on('error', rejectProcess)
    child.on('close', (exitCode) => resolveProcess({ exitCode, stderr, stdout }))
  })
}

const redistributedThirdPartyPackages = [
  '@electron-toolkit/utils',
  '@tiptap/core',
  '@tiptap/extension-blockquote',
  '@tiptap/extension-bold',
  '@tiptap/extension-code',
  '@tiptap/extension-code-block',
  '@tiptap/extension-document',
  '@tiptap/extension-hard-break',
  '@tiptap/extension-heading',
  '@tiptap/extension-horizontal-rule',
  '@tiptap/extension-italic',
  '@tiptap/extension-link',
  '@tiptap/extension-list',
  '@tiptap/extension-paragraph',
  '@tiptap/extension-strike',
  '@tiptap/extension-text',
  '@tiptap/extension-underline',
  '@tiptap/extensions',
  '@tiptap/pm',
  '@tiptap/react',
  '@tiptap/starter-kit',
  'electron',
  'fast-equals',
  'linkifyjs',
  'lucide-react',
  'orderedmap',
  'prosemirror-commands',
  'prosemirror-dropcursor',
  'prosemirror-gapcursor',
  'prosemirror-history',
  'prosemirror-keymap',
  'prosemirror-model',
  'prosemirror-schema-list',
  'prosemirror-state',
  'prosemirror-transform',
  'prosemirror-view',
  'react',
  'react-dom',
  'rope-sequence',
  'scheduler',
  'signal-exit',
  'use-sync-external-store',
  'w3c-keyname',
  'write-file-atomic'
] as const

describe('desktop release configuration', () => {
  test('declares MPL-2.0 consistently in package metadata', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'package.json'), 'utf8')
    ) as { license?: string }
    const packageLock = JSON.parse(
      await readFile(resolve(projectRoot, 'package-lock.json'), 'utf8')
    ) as { packages?: Record<string, { license?: string }> }

    expect(packageJson.license).toBe('MPL-2.0')
    expect(packageLock.packages?.['']?.license).toBe('MPL-2.0')
  })

  test('publishes the license, source instructions, and asset exclusions', async () => {
    const [license, notices, assetLicense, readme] = await Promise.all(
      ['LICENSE', 'OPEN_SOURCE_NOTICES.md', 'ASSETS-LICENSE.md', 'README.md'].map((file) =>
        readFile(resolve(projectRoot, file), 'utf8').catch(() => '')
      )
    )

    expect(license).toContain('Mozilla Public License Version 2.0')
    expect(license).toContain('3.2. Distribution of Executable Form')
    expect(notices).toContain('https://github.com/wj0s3ph/inkprompts-app')
    expect(notices).toContain('MPL-2.0')
    expect(assetLicense).toContain('build/icon.icns')
    expect(assetLicense).toContain('src/renderer/src/assets/hero-writing.svg')
    expect(assetLicense).toContain('not licensed under the MPL-2.0')
    expect(readme).toContain('## License')
    expect(readme).toContain('ASSETS-LICENSE.md')
  })

  test('preserves the MIT attribution for the original Electron scaffold', async () => {
    const [notices, templateLicense] = await Promise.all([
      readFile(resolve(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
      readFile(resolve(projectRoot, 'build/quick-start-template.LICENSE'), 'utf8').catch(() => '')
    ])

    expect(templateLicense).toContain('Copyright (c) 2022, Alex Wei')
    expect(notices).toContain('@quick-start/electron React TypeScript template')
    expect(notices).toContain('Copyright (c) 2022, Alex Wei')
  })

  test('includes project license notices in every packaged application', async () => {
    const builder = await readFile(resolve(projectRoot, 'electron-builder.yml'), 'utf8')

    expect(builder).toMatch(/extraResources:[\s\S]*from: LICENSE[\s\S]*to: LICENSE\.txt/)
    expect(builder).toMatch(
      /extraResources:[\s\S]*from: OPEN_SOURCE_NOTICES\.md[\s\S]*to: OPEN_SOURCE_NOTICES\.md/
    )
    expect(builder).toMatch(
      /extraResources:[\s\S]*from: ASSETS-LICENSE\.md[\s\S]*to: ASSETS-LICENSE\.md/
    )
  })

  test('packages only explicit runtime files and installs an archive boundary check', async () => {
    const builder = await readFile(resolve(projectRoot, 'electron-builder.yml'), 'utf8')
    const afterPack = await readFile(resolve(projectRoot, 'build/after-pack.cjs'), 'utf8')
    const packageContents = await readFile(
      resolve(projectRoot, 'build/package-contents.cjs'),
      'utf8'
    ).catch(() => '')

    for (const allowed of [
      "- 'out/**'",
      "- 'package.json'",
      "- 'resources/**'",
      "- 'node_modules/@electron-toolkit/utils/**'",
      "- 'node_modules/write-file-atomic/**'",
      "- 'node_modules/signal-exit/**'"
    ]) {
      expect(builder).toContain(allowed)
    }
    expect(builder).not.toMatch(/^\s+- '!docs\/\*\*'$/m)
    expect(afterPack).toContain("require('./package-contents.cjs')")
    expect(packageContents).toContain('assertPackagedApplicationFiles')
  })

  test('exposes a package entry boundary validator', () => {
    const packageContents = require('../build/package-contents.cjs') as Record<string, unknown>

    expect(packageContents.assertPackagedApplicationEntries).toBeTypeOf('function')
  })

  test('declares the archive reader used by the package boundary check', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'package.json'), 'utf8')
    ) as { devDependencies?: Record<string, string> }

    expect(packageJson.devDependencies?.['@electron/asar']).toBe('3.4.1')
  })

  test('accepts only the files required by the packaged application', () => {
    const { assertPackagedApplicationEntries } = require('../build/package-contents.cjs') as {
      assertPackagedApplicationEntries(entries: string[]): void
    }

    expect(() =>
      assertPackagedApplicationEntries([
        '/out',
        '/out/main',
        '/out/main/index.js',
        '/out/preload',
        '/out/preload/index.js',
        '/out/renderer',
        '/out/renderer/index.html',
        '/package.json',
        '/resources',
        '/resources/icon.png',
        '/node_modules',
        '/node_modules/@electron-toolkit',
        '/node_modules/@electron-toolkit/utils',
        '/node_modules/@electron-toolkit/utils/package.json',
        '/node_modules/write-file-atomic',
        '/node_modules/write-file-atomic/package.json',
        '/node_modules/signal-exit',
        '/node_modules/signal-exit/package.json'
      ])
    ).not.toThrow()
  })

  test.each(['/.agents/skills/implement/SKILL.md', '/tests/journal-shell.test.ts'])(
    'rejects internal package entry %s',
    (entry) => {
      const { assertPackagedApplicationEntries } = require('../build/package-contents.cjs') as {
        assertPackagedApplicationEntries(entries: string[]): void
      }

      expect(() => assertPackagedApplicationEntries([entry])).toThrow(entry)
    }
  )

  test.each([
    '/node_modules/unexpected-secret-package/private-key.txt',
    '/node_modules/@unexpected/secret-package/package.json',
    '/out/main/internal-notes.txt',
    '/resources/private-key.pem'
  ])('rejects unexpected packaged entry %s', (entry) => {
    const { assertPackagedApplicationEntries } = require('../build/package-contents.cjs') as {
      assertPackagedApplicationEntries(entries: string[]): void
    }

    expect(() => assertPackagedApplicationEntries([entry])).toThrow(entry)
  })

  test('rejects a package missing a required runtime entry', () => {
    const { assertPackagedApplicationEntries } = require('../build/package-contents.cjs') as {
      assertPackagedApplicationEntries(entries: string[]): void
    }

    expect(() => assertPackagedApplicationEntries(['/package.json'])).toThrow('/out/main/index.js')
  })

  test('tracks the exact licenses of every component redistributed with the app', async () => {
    const components = JSON.parse(
      await readFile(resolve(projectRoot, 'build/third-party-components.json'), 'utf8').catch(
        () => '[]'
      )
    ) as Array<{
      name: string
      version: string
      license: string
      packagePath: string
      licensePath: string
    }>
    const notices = await readFile(resolve(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8').catch(
      () => ''
    )

    expect(components.map(({ name }) => name)).toEqual(redistributedThirdPartyPackages)
    expect(new Set(components.map(({ name }) => name)).size).toBe(components.length)

    for (const component of components) {
      const metadata = JSON.parse(
        await readFile(resolve(projectRoot, component.packagePath, 'package.json'), 'utf8')
      ) as { name: string; version: string; license: string }
      const licenseText = await readFile(resolve(projectRoot, component.licensePath), 'utf8')

      expect(metadata).toMatchObject({
        name: component.name,
        version: component.version,
        license: component.license
      })
      expect(notices).toContain(component.name)
      expect(notices).toContain(component.version)
      expect(notices).toContain(licenseText.trim())
    }

    expect(components.find(({ name }) => name === 'signal-exit')).toMatchObject({
      version: '4.1.0',
      packagePath: 'node_modules/write-file-atomic/node_modules/signal-exit'
    })
    expect(components.find(({ name }) => name === 'electron')).toMatchObject({
      version: '43.4.0',
      licensePath: 'node_modules/electron/LICENSE'
    })
  })

  test('rejects a bundled package missing from the third-party inventory', async () => {
    const auditDirectory = await mkdtemp(join(tmpdir(), 'inkprompts-license-audit-'))
    try {
      const packages = [...redistributedThirdPartyPackages, 'unlisted-test-package']
      await Promise.all(
        ['main', 'preload', 'renderer'].map((target) =>
          writeFile(
            resolve(auditDirectory, `${target}.json`),
            `${JSON.stringify({ packages }, null, 2)}\n`
          )
        )
      )

      const result = await runLicenseCheck(auditDirectory)

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('unlisted-test-package')
    } finally {
      await rm(auditDirectory, { recursive: true, force: true })
    }
  })

  test('provides a build plugin for recording bundled package names', async () => {
    const auditPlugin = await readFile(
      resolve(projectRoot, 'build/redistributed-package-audit.mjs'),
      'utf8'
    ).catch(() => '')

    expect(auditPlugin).toContain('createRedistributedPackageAuditPlugin')
  })

  test('records the package names that contribute modules to a production bundle', async () => {
    const auditDirectory = await mkdtemp(join(tmpdir(), 'inkprompts-bundle-audit-'))
    try {
      const { createRedistributedPackageAuditPlugin } =
        (await import('../build/redistributed-package-audit.mjs')) as {
          createRedistributedPackageAuditPlugin(
            target: string,
            options: { auditDirectory: string }
          ): {
            transform: (code: string, moduleId: string) => null
            closeBundle: () => Promise<void>
          }
        }
      const plugin = createRedistributedPackageAuditPlugin('renderer', { auditDirectory })
      const moduleIds = [
        '/project/src/renderer.tsx',
        '/project/node_modules/@tiptap/pm/dist/state/index.js',
        '/project/node_modules/react/index.js?commonjs-entry',
        '/project/node_modules/write-file-atomic/node_modules/signal-exit/dist/mjs/index.js',
        'C:\\project\\src\\renderer.tsx',
        'C:\\project\\node_modules\\react-dom\\index.js'
      ]

      expect(plugin).toBeDefined()
      expect(plugin.transform).toBeTypeOf('function')
      expect(plugin.closeBundle).toBeTypeOf('function')
      for (const moduleId of moduleIds) plugin.transform('', moduleId)
      await plugin.closeBundle()

      const manifest = JSON.parse(
        await readFile(resolve(auditDirectory, 'renderer.json'), 'utf8')
      ) as { packages: string[] }
      expect(manifest.packages).toEqual(['@tiptap/pm', 'react', 'react-dom', 'signal-exit'])
    } finally {
      await rm(auditDirectory, { recursive: true, force: true })
    }
  })

  test('audits every Electron bundle before checking or packaging license notices', async () => {
    const viteConfig = await readFile(resolve(projectRoot, 'electron.vite.config.ts'), 'utf8')
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> }

    for (const target of ['main', 'preload', 'renderer']) {
      expect(viteConfig).toContain(
        `createRedistributedPackageAuditPlugin('${target}', { auditDirectory })`
      )
    }
    expect(packageJson.scripts?.['license:check']).toContain('npm run build')
    expect(packageJson.scripts?.['license:generate']).toContain('npm run build')
    for (const script of ['build:unpack', 'build:mac', 'build:win', 'build:linux']) {
      expect(packageJson.scripts?.[script]).toContain('license:check:generated')
    }
  })

  test('packages the npm, Electron, and Chromium license records', async () => {
    const builder = await readFile(resolve(projectRoot, 'electron-builder.yml'), 'utf8')
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> }
    const preparation = await readFile(
      resolve(projectRoot, 'build/prepare-electron-licenses.mjs'),
      'utf8'
    ).catch(() => '')
    const electronLicense = await stat(resolve(projectRoot, 'node_modules/electron/LICENSE'))
    const chromiumLicenses = await stat(
      resolve(projectRoot, 'node_modules/electron/dist/LICENSES.chromium.html')
    )

    expect(builder).toMatch(/from: THIRD_PARTY_NOTICES\.md[\s\S]*to: THIRD_PARTY_NOTICES\.md/)
    expect(builder).toMatch(/from: node_modules\/electron\/LICENSE[\s\S]*to: ELECTRON_LICENSE\.txt/)
    expect(builder).toMatch(
      /from: node_modules\/electron\/dist\/LICENSES\.chromium\.html[\s\S]*to: THIRD_PARTY_LICENSES\.chromium\.html/
    )
    expect(packageJson.scripts?.['prepare:electron-licenses']).toBe(
      'node build/prepare-electron-licenses.mjs'
    )
    expect(packageJson.scripts?.postinstall).toContain('npm run prepare:electron-licenses')
    expect(preparation).toContain("require('electron')")
    expect(preparation).toContain('LICENSES.chromium.html')
    expect(electronLicense.size).toBeGreaterThan(1_000)
    expect(chromiumLicenses.size).toBeGreaterThan(10_000_000)
  })

  test('uses product identity and contains no updater or template publishing endpoint', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'package.json'), 'utf8')
    ) as {
      name: string
      productName?: string
      description: string
      author: string
      homepage: string
      dependencies?: Record<string, string>
    }
    const builder = await readFile(resolve(projectRoot, 'electron-builder.yml'), 'utf8')

    expect(packageJson).toMatchObject({
      name: 'inkprompts-journal',
      productName: 'InkPrompts Journal',
      description: 'A private, encrypted daily journal that stays on your device.',
      author: 'Chao Wang <hello@inkprompts.com>',
      homepage: 'https://inkprompts.com/journal'
    })
    expect(packageJson.dependencies).not.toHaveProperty('electron-updater')
    expect(builder).toContain('appId: com.inkprompts.journal')
    expect(builder).toContain('productName: InkPrompts Journal')
    expect(builder).toContain('executableName: InkPrompts-Journal')
    expect(builder).not.toMatch(/example\.com|publish:|NSCamera|NSMicrophone/)
  })

  test('pins Electron 43.4.0 in both package manifests', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'package.json'), 'utf8')
    ) as { devDependencies?: Record<string, string> }
    const packageLock = JSON.parse(
      await readFile(resolve(projectRoot, 'package-lock.json'), 'utf8')
    ) as {
      packages?: Record<string, { devDependencies?: Record<string, string>; version?: string }>
    }

    expect(packageJson.devDependencies?.electron).toBe('43.4.0')
    expect(packageLock.packages?.['']?.devDependencies?.electron).toBe('43.4.0')
    expect(packageLock.packages?.['node_modules/electron']?.version).toBe('43.4.0')
  })

  test('keeps public packaging certificate-free without deleting private app data on uninstall', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> }
    const builder = await readFile(resolve(projectRoot, 'electron-builder.yml'), 'utf8')
    const developmentPackager = await readFile(
      resolve(projectRoot, 'build/package-development.mjs'),
      'utf8'
    ).catch(() => '')
    const gitignore = await readFile(resolve(projectRoot, '.gitignore'), 'utf8')
    const afterPack = await readFile(resolve(projectRoot, 'build/after-pack.cjs'), 'utf8')

    expect(packageJson.scripts?.['build:unpack']).toContain(
      'node build/package-development.mjs --dir'
    )
    expect(packageJson.scripts?.['build:mac']).toContain('node build/package-development.mjs --mac')
    expect(packageJson.scripts?.['build:win']).toContain('node build/package-development.mjs --win')
    expect(packageJson.scripts?.['build:linux']).toContain(
      'node build/package-development.mjs --linux'
    )
    expect(packageJson.scripts).not.toHaveProperty('build:mac:mas')
    expect(packageJson.scripts).not.toHaveProperty('build:mac:mas:dev')

    expect(builder).toContain('signExecutable: false')
    expect(builder).toContain("identity: '-'")
    expect(builder).toContain('hardenedRuntime: false')
    expect(builder).toContain('notarize: false')
    expect(builder).toContain('deleteAppDataOnUninstall: false')
    expect(builder).toContain("minimumSystemVersion: '12.0'")
    expect(builder).toContain('PrivacyInfo.xcprivacy')
    expect(builder).not.toMatch(
      /signAndEditExecutable:\s*true|hardenedRuntime:\s*true|notarize:\s*true|forceCodeSigning:|provisioningProfile:|^mas:|^masDev:/m
    )
    expect(developmentPackager).toContain('CSC_IDENTITY_AUTO_DISCOVERY')
    expect(developmentPackager).toContain('--config.win.signExecutable=false')
    expect(gitignore).toMatch(/^\.private-release\/$/m)

    for (const key of [
      'NSAppTransportSecurity',
      'NSAudioCaptureUsageDescription',
      'NSBluetoothAlwaysUsageDescription',
      'NSBluetoothPeripheralUsageDescription',
      'NSCameraUsageDescription',
      'NSMicrophoneUsageDescription'
    ]) {
      expect(afterPack).toContain(key)
    }
  })

  test('rejects signing credentials without leaking their values', async () => {
    const secretValue = 'not-a-real-signing-secret'
    const result = await runDevelopmentPackager(['--dir'], { CSC_LINK: secretValue })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('CSC_LINK')
    expect(result.stderr).not.toContain(secretValue)
  })

  test.each([
    ['--mac', 'mas'],
    ['--dir', '--config.mac.identity=Developer ID Application']
  ])('rejects public signing argument overrides: %s %s', async (...args) => {
    const result = await runDevelopmentPackager(args)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Development packaging accepts exactly one target')
  })

  test('keeps least-privilege entitlement assets for the private release environment', async () => {
    const developerIdEntitlements = await readFile(
      resolve(projectRoot, 'build/entitlements.mac.plist'),
      'utf8'
    )
    const entitlements = await readFile(
      resolve(projectRoot, 'build/entitlements.mas.plist'),
      'utf8'
    )
    const inheritedEntitlements = await readFile(
      resolve(projectRoot, 'build/entitlements.mas.inherit.plist'),
      'utf8'
    )

    expect(developerIdEntitlements).toContain('com.apple.security.cs.allow-jit')
    expect(developerIdEntitlements).not.toContain('allow-dyld-environment-variables')
    expect(entitlements).toContain('com.apple.security.app-sandbox')
    expect(entitlements).toContain('com.apple.security.cs.allow-jit')
    expect(entitlements).toContain('com.apple.security.files.user-selected.read-write')
    expect(entitlements).not.toMatch(/network|camera|microphone|usb|print/)
    expect(inheritedEntitlements).toContain('com.apple.security.app-sandbox')
    expect(inheritedEntitlements).toContain('com.apple.security.inherit')
    expect(inheritedEntitlements).not.toContain('files.user-selected')
  })

  test('ships an application Privacy Manifest with no tracking or collected data claims', async () => {
    const manifest = plist.parse(
      await readFile(resolve(projectRoot, 'build/PrivacyInfo.xcprivacy'), 'utf8')
    ) as Record<string, unknown>

    expect(manifest).toEqual({
      NSPrivacyAccessedAPITypes: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: []
    })
  })

  test('ships original cross-platform icon sources and the public verification workflow', async () => {
    const buildIcon = await readFile(resolve(projectRoot, 'build/icon.png'))
    const runtimeIcon = await readFile(resolve(projectRoot, 'resources/icon.png'))

    expect(buildIcon.equals(runtimeIcon)).toBe(true)
    expect(buildIcon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(buildIcon.subarray(12, 16).toString('ascii')).toBe('IHDR')
    expect(buildIcon.readUInt32BE(16)).toBe(1024)
    expect(buildIcon.readUInt32BE(20)).toBe(1024)
    expect(createHash('sha256').update(buildIcon).digest('hex')).toBe(
      'fe6e1a7c5211b4709a87f3fa738264d1b903195c36860ec1787194e42c834900'
    )
    expect((await stat(resolve(projectRoot, 'build/icon.icns'))).size).toBeGreaterThan(0)
    expect((await stat(resolve(projectRoot, 'build/icon.ico'))).size).toBeGreaterThan(0)
    expect((await stat(resolve(projectRoot, '.github/workflows/verify.yml'))).isFile()).toBe(true)
  })

  test('keeps credential-backed signing and release automation out of the public repository', async () => {
    const workflowDirectory = resolve(projectRoot, '.github/workflows')
    const workflowFiles = (await readdir(workflowDirectory)).sort()
    const workflow = await readFile(resolve(workflowDirectory, 'verify.yml'), 'utf8')

    expect(workflowFiles).toEqual(['verify.yml'])
    expect(workflow).toContain('npm run build:unpack')
    expect(workflow).not.toMatch(
      /workflow_dispatch:|secrets\.|codesign|notary|stapler|Get-AuthenticodeSignature|upload-artifact/i
    )
  })

  test('keeps public website links centrally validated', async () => {
    const urlCheck = await readFile(
      resolve(projectRoot, 'build/check-public-release-urls.mjs'),
      'utf8'
    )
    const externalPageUrls = JSON.parse(
      await readFile(resolve(projectRoot, 'src/main/ipc/external-page-urls.json'), 'utf8')
    ) as Record<string, string>

    expect(externalPageUrls).toEqual({
      website: 'https://inkprompts.com/journal',
      privacy: 'https://inkprompts.com/privacy',
      terms: 'https://inkprompts.com/terms',
      support: 'https://inkprompts.com/contact'
    })
    expect(urlCheck).toContain('external-page-urls.json')
  })
})
