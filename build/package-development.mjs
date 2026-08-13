import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const allowedTargets = new Set(['--dir', '--linux', '--mac', '--win'])
const signingVariables = [
  'APPLE_API_ISSUER',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_ID',
  'APPLE_KEYCHAIN',
  'APPLE_KEYCHAIN_PROFILE',
  'APPLE_TEAM_ID',
  'AZURE_CERTIFICATE_PROFILE_NAME',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_CODE_SIGNING_ACCOUNT_NAME',
  'AZURE_ENDPOINT',
  'AZURE_TENANT_ID',
  'CSC_INSTALLER_KEY_PASSWORD',
  'CSC_INSTALLER_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_KEYCHAIN',
  'CSC_LINK',
  'CSC_NAME',
  'MAS_APP_CERTIFICATE_BASE64',
  'MAS_APP_CERTIFICATE_PASSWORD',
  'MAS_INSTALLER_CERTIFICATE_BASE64',
  'MAS_INSTALLER_CERTIFICATE_PASSWORD',
  'MAS_PROVISIONING_PROFILE_BASE64',
  'MAS_TEAM_ID',
  'WIN_CSC_KEY_PASSWORD',
  'WIN_CSC_LINK',
  'WIN_CSC_SHA1',
  'WIN_CSC_SUBJECT_NAME'
]

function assertDevelopmentArguments(args) {
  if (args.length !== 1 || !allowedTargets.has(args[0])) {
    throw new Error(
      'Development packaging accepts exactly one target: --dir, --mac, --win, or --linux.'
    )
  }
}

function assertCertificateFreeEnvironment(environment) {
  const presentVariables = signingVariables.filter((name) => environment[name]?.trim())
  if (
    environment.CSC_IDENTITY_AUTO_DISCOVERY &&
    environment.CSC_IDENTITY_AUTO_DISCOVERY !== 'false'
  ) {
    presentVariables.push('CSC_IDENTITY_AUTO_DISCOVERY')
  }
  if (presentVariables.length > 0) {
    throw new Error(
      `Signing variables are not accepted by public packaging: ${presentVariables.sort().join(', ')}`
    )
  }
}

async function run() {
  assertDevelopmentArguments(process.argv.slice(2))
  assertCertificateFreeEnvironment(process.env)

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const electronBuilderCli = resolve(projectRoot, 'node_modules/electron-builder/cli.js')
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    const child = spawn(
      process.execPath,
      [
        electronBuilderCli,
        ...process.argv.slice(2),
        '--publish',
        'never',
        '--config.win.signExecutable=false'
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
        stdio: 'inherit'
      }
    )

    child.once('error', rejectExit)
    child.once('exit', (code) => resolveExit(code ?? 1))
  })

  process.exitCode = exitCode
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Development packaging failed.')
  process.exitCode = 1
})
