import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const inventoryPath = resolve(projectRoot, 'build/third-party-components.json')
const noticesPath = resolve(projectRoot, 'THIRD_PARTY_NOTICES.md')
const templateLicensePath = resolve(projectRoot, 'build/quick-start-template.LICENSE')
const auditDirectory =
  process.env.INKPROMPTS_LICENSE_AUDIT_DIR ?? resolve(projectRoot, '.scratch/license-audit')
const bundleTargets = ['main', 'preload', 'renderer']

function normalizeRepository(repository, homepage) {
  const value = typeof repository === 'string' ? repository : repository?.url
  if (!value) return homepage

  return value
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
}

function findInstalledDependency(packages, parentPath, dependencyName) {
  let searchPath = parentPath
  while (true) {
    const candidate = [searchPath, 'node_modules', dependencyName].filter(Boolean).join('/')
    if (packages[candidate]) return candidate

    const nestedIndex = searchPath.lastIndexOf('/node_modules/')
    if (nestedIndex >= 0) {
      searchPath = searchPath.slice(0, nestedIndex)
    } else if (searchPath) {
      searchPath = ''
    } else {
      throw new Error(`package-lock.json cannot resolve production dependency ${dependencyName}`)
    }
  }
}

async function discoverRedistributedPackages() {
  const packageLock = JSON.parse(await readFile(resolve(projectRoot, 'package-lock.json'), 'utf8'))
  const packages = packageLock.packages ?? {}
  const discovered = new Set(['electron'])
  const queue = Object.keys(packages['']?.dependencies ?? {}).map((name) => ({
    name,
    parentPath: ''
  }))
  const visitedPaths = new Set()

  while (queue.length > 0) {
    const dependency = queue.shift()
    const packagePath = findInstalledDependency(packages, dependency.parentPath, dependency.name)
    if (visitedPaths.has(packagePath)) continue
    visitedPaths.add(packagePath)
    discovered.add(dependency.name)

    const metadata = packages[packagePath]
    const childDependencies = {
      ...(metadata.dependencies ?? {}),
      ...(metadata.optionalDependencies ?? {})
    }
    for (const name of Object.keys(childDependencies)) {
      queue.push({ name, parentPath: packagePath })
    }
  }

  for (const target of bundleTargets) {
    const manifest = JSON.parse(
      await readFile(resolve(auditDirectory, `${target}.json`), 'utf8').catch(() => {
        throw new Error(`Missing ${target} bundle license audit; run npm run build first.`)
      })
    )
    if (!Array.isArray(manifest.packages)) {
      throw new Error(`Invalid ${target} bundle license audit.`)
    }
    for (const packageName of manifest.packages) discovered.add(packageName)
  }

  return discovered
}

function assertCompleteInventory(inventory, discovered) {
  const inventoried = new Set(inventory.map(({ name }) => name))
  const missing = [...discovered].filter((name) => !inventoried.has(name)).sort()
  if (missing.length > 0) {
    throw new Error(
      `Third-party inventory is missing redistributed packages: ${missing.join(', ')}`
    )
  }

  const extra = [...inventoried].filter((name) => !discovered.has(name)).sort()
  if (extra.length > 0) {
    throw new Error(
      `Third-party inventory lists packages not found in the build: ${extra.join(', ')}`
    )
  }
}

async function loadComponents(inventory) {
  const components = []

  for (const expected of inventory) {
    const metadata = JSON.parse(
      await readFile(resolve(projectRoot, expected.packagePath, 'package.json'), 'utf8')
    )
    for (const field of ['name', 'version', 'license']) {
      if (metadata[field] !== expected[field]) {
        throw new Error(
          `${expected.name}: expected ${field} ${expected[field]}, found ${metadata[field]}`
        )
      }
    }

    components.push({
      ...expected,
      repository: normalizeRepository(metadata.repository, metadata.homepage),
      licenseText: (await readFile(resolve(projectRoot, expected.licensePath), 'utf8')).trim()
    })
  }

  return components
}

function renderNotices(components, templateLicense) {
  const licenseGroups = new Map()
  for (const component of components) {
    const group = licenseGroups.get(component.licenseText) ?? []
    group.push(component)
    licenseGroups.set(component.licenseText, group)
  }

  const rows = components.map(({ name, version, license, repository }) => {
    const component = repository ? `[${name}](${repository})` : name
    return `| ${component} | ${version} | ${license} |`
  })

  const texts = [...licenseGroups.entries()].map(([licenseText, group], index) => {
    const names = group.map(({ name, version }) => `${name}@${version}`).join(', ')
    return [
      `### ${group[0].license} license text ${index + 1}`,
      '',
      `Applies to: ${names}`,
      '',
      '```text',
      licenseText,
      '```'
    ].join('\n')
  })

  return [
    '# Third-Party Notices',
    '',
    'This file records the JavaScript packages and Electron runtime redistributed with InkPrompts Journal. It is generated from `build/third-party-components.json` and the exact license files installed by `npm ci`; do not edit it manually.',
    '',
    "Electron includes Chromium, Node.js, V8, OpenSSL, and other native components. Their complete version-specific notices are copied unchanged from Electron 43.4.0 into every packaged application as `THIRD_PARTY_LICENSES.chromium.html`. Electron's own license is also included as `ELECTRON_LICENSE.txt`.",
    '',
    'The presence of a component below does not imply endorsement of InkPrompts Journal by its authors.',
    '',
    '## Project scaffold attribution',
    '',
    'Portions of the original project scaffold were generated from the [@quick-start/electron React TypeScript template](https://github.com/alex8088/quick-start), under the following MIT license:',
    '',
    '```text',
    templateLicense,
    '```',
    '',
    '## Redistributed components',
    '',
    '| Component | Version | License |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '## License texts',
    '',
    ...texts.flatMap((text, index) => (index === 0 ? [text] : ['', text])),
    ''
  ].join('\n')
}

const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))
assertCompleteInventory(inventory, await discoverRedistributedPackages())
const templateLicense = (await readFile(templateLicensePath, 'utf8')).trim()
const notices = renderNotices(await loadComponents(inventory), templateLicense)

if (process.argv.includes('--check')) {
  const current = await readFile(noticesPath, 'utf8').catch(() => '')
  if (current !== notices) {
    throw new Error('THIRD_PARTY_NOTICES.md is stale; run npm run license:generate')
  }
} else {
  await writeFile(noticesPath, notices)
}
