import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const defaultAuditDirectory = resolve(import.meta.dirname, '..', '.scratch', 'license-audit')

function packageNameFromModuleId(moduleId) {
  const normalizedModuleId = moduleId.replaceAll('\\', '/').split('?')[0]
  const packagePath = normalizedModuleId.split('/node_modules/').at(-1)
  if (!packagePath || packagePath === normalizedModuleId) return null

  const [first, second] = packagePath.split('/')
  if (!first) return null
  return first.startsWith('@') ? (second ? `${first}/${second}` : null) : first
}

export function createRedistributedPackageAuditPlugin(target, options = {}) {
  const auditDirectory =
    options.auditDirectory ?? process.env.INKPROMPTS_LICENSE_AUDIT_DIR ?? defaultAuditDirectory
  const packages = new Set()

  return {
    name: `inkprompts-redistributed-package-audit-${target}`,
    apply: 'build',
    transform(_code, moduleId) {
      const packageName = packageNameFromModuleId(moduleId)
      if (packageName) packages.add(packageName)
      return null
    },
    async closeBundle() {
      await mkdir(auditDirectory, { recursive: true })
      await writeFile(
        resolve(auditDirectory, `${target}.json`),
        `${JSON.stringify({ packages: [...packages].sort() }, null, 2)}\n`
      )
    }
  }
}
