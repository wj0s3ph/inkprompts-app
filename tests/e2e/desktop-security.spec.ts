import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { encryptPortableBackup } from '../../src/main/storage/portable-backup'

const mainEntry = resolve(process.cwd(), 'out/main/index.js')

async function launchJournal(
  userData: string,
  rendererRequests?: string[]
): Promise<{ application: ElectronApplication; page: Page }> {
  const executablePath = process.env.INKPROMPTS_EXECUTABLE_PATH
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath
      ? [`--user-data-dir=${userData}`]
      : [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production' }
  })
  if (rendererRequests) await installNetworkObservation(application)
  const page = await application.firstWindow()
  page.on('request', (request) => {
    if (rendererRequests && /^https?:/.test(request.url())) rendererRequests.push(request.url())
  })
  return { application, page }
}

async function installNetworkObservation(application: ElectronApplication): Promise<void> {
  await application.evaluate(({ session }) => {
    const state = globalThis as typeof globalThis & {
      inkpromptsNetworkRequests?: { session: string[]; main: string[] }
    }
    state.inkpromptsNetworkRequests = { session: [], main: [] }
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => {
        state.inkpromptsNetworkRequests!.session.push(details.url)
        callback({})
      }
    )
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (...args) => {
      const input = args[0]
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/^https?:/.test(url)) state.inkpromptsNetworkRequests!.main.push(url)
      return originalFetch(...args)
    }
  })
}

async function expectNoNetworkRequests(
  application: ElectronApplication,
  rendererRequests: string[]
): Promise<void> {
  const observed = await application.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      inkpromptsNetworkRequests?: { session: string[]; main: string[] }
    }
    return state.inkpromptsNetworkRequests ?? { session: [], main: [] }
  })
  expect({ renderer: rendererRequests, ...observed }).toEqual({
    renderer: [],
    session: [],
    main: []
  })
}

async function expectManagedVaultAbsent(userData: string): Promise<void> {
  for (const managedPath of [
    'journal-erasure.pending',
    'journal.key',
    'journal.vault',
    'snapshots'
  ]) {
    await expect(access(join(userData, managedPath))).rejects.toMatchObject({ code: 'ENOENT' })
  }
}

async function selectPortableBackup(
  application: ElectronApplication,
  backupPath: string | null
): Promise<void> {
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = (async () =>
      selectedPath
        ? { canceled: false, filePaths: [selectedPath] }
        : { canceled: true, filePaths: [] }) as typeof dialog.showOpenDialog
  }, backupPath)
}

async function stopJournal(application: ElectronApplication | undefined): Promise<void> {
  if (!application) return
  if (process.platform !== 'linux') {
    await application.close()
    return
  }
  const childProcess = application.process()
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return
  const closed = application.waitForEvent('close', { timeout: 5_000 }).catch(() => undefined)
  childProcess.kill()
  await closed
}

async function removeUserData(userData: string): Promise<void> {
  await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

test('keeps the editor actions inside a small laptop window', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'inkprompts-layout-e2e-'))
  let application: ElectronApplication | undefined

  try {
    const journal = await launchJournal(userData)
    application = journal.application
    const storage = await application.evaluate(({ safeStorage }) => ({
      available: safeStorage.isEncryptionAvailable(),
      backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'system'
    }))
    test.skip(
      !storage.available || storage.backend === 'basic_text',
      'Secure storage is unavailable'
    )

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1200, 640)
    })
    await expect.poll(() => journal.page.evaluate(() => window.innerHeight)).toBe(640)
    await journal.page.getByRole('button', { name: 'Start writing' }).click()
    await expect(journal.page.getByRole('textbox', { name: 'Daily Entry body' })).toBeVisible()

    const viewportHeight = await journal.page.evaluate(() => window.innerHeight)
    const doneBounds = await journal.page
      .getByRole('button', { name: 'Done for Today' })
      .boundingBox()
    expect(doneBounds, 'Done for Today should have layout bounds').not.toBeNull()
    expect(
      doneBounds!.y,
      'Done for Today should not start above the viewport'
    ).toBeGreaterThanOrEqual(0)
    expect(
      doneBounds!.y + doneBounds!.height,
      'Done for Today should not extend below the viewport'
    ).toBeLessThanOrEqual(viewportHeight)
  } finally {
    await stopJournal(application)
    await removeUserData(userData)
  }
})

test('renders the editor controls inside a ruled open notebook', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'inkprompts-notebook-e2e-'))
  let application: ElectronApplication | undefined

  try {
    const journal = await launchJournal(userData)
    application = journal.application
    const storage = await application.evaluate(({ safeStorage }) => ({
      available: safeStorage.isEncryptionAvailable(),
      backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'system'
    }))
    test.skip(
      !storage.available || storage.backend === 'basic_text',
      'Secure storage is unavailable'
    )

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1200, 640)
    })
    await expect.poll(() => journal.page.evaluate(() => window.innerHeight)).toBe(640)
    await journal.page.getByRole('button', { name: 'Start writing' }).click()

    const notebook = journal.page.getByRole('region', { name: 'Journal notebook' })
    await expect(notebook).toBeVisible()
    await expect(notebook.getByRole('toolbar', { name: 'Formatting tools' })).toBeVisible()
    await expect(notebook.getByRole('textbox', { name: 'Optional title' })).toBeVisible()
    await expect(notebook.getByRole('textbox', { name: 'Daily Entry body' })).toBeVisible()

    const visualTreatment = await notebook.evaluate((element) => {
      const notebookStyle = getComputedStyle(element)
      const pageMargin = getComputedStyle(element, '::before')
      const centerSeam = getComputedStyle(element, '::after')
      const writingLines = getComputedStyle(
        element.querySelector<HTMLElement>('.journal-writing-lines')!
      )
      return {
        borderRadius: Number.parseFloat(notebookStyle.borderRadius),
        lines: writingLines.backgroundImage,
        margin: pageMargin.content,
        seam: centerSeam.content
      }
    })
    expect(visualTreatment.borderRadius).toBeGreaterThanOrEqual(16)
    expect(visualTreatment.lines).toContain('repeating-linear-gradient')
    expect(visualTreatment.margin).not.toBe('none')
    expect(visualTreatment.seam).not.toBe('none')
  } finally {
    await stopJournal(application)
    await removeUserData(userData)
  }
})

test('keeps PIN recovery actions reachable at the minimum window size', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'inkprompts-recovery-layout-e2e-'))
  let application: ElectronApplication | undefined

  try {
    const journal = await launchJournal(userData)
    application = journal.application
    const storage = await application.evaluate(({ safeStorage }) => ({
      available: safeStorage.isEncryptionAvailable(),
      backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'system'
    }))
    test.skip(
      !storage.available || storage.backend === 'basic_text',
      'Secure storage is unavailable'
    )

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(720, 560)
    })
    await expect.poll(() => journal.page.evaluate(() => window.innerHeight)).toBe(560)
    await journal.page.getByRole('button', { name: 'Start writing' }).click()
    await journal.page.getByRole('button', { name: 'Settings' }).click()
    await journal.page.getByLabel('New 6-digit PIN').fill('654321')
    await journal.page.getByLabel('Confirm new PIN').fill('654321')
    await journal.page.getByRole('button', { name: 'Enable PIN Lock' }).click()
    await journal.page.getByRole('button', { name: 'Close Settings' }).click()
    await journal.page.getByRole('button', { name: 'Lock', exact: true }).click()
    await journal.page.getByRole('button', { name: 'I forgot my PIN' }).click()

    const recoveryShell = journal.page.locator('.app-state-shell')
    const layout = await recoveryShell.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight
    }))
    expect(layout.clientHeight).toBe(560)
    expect(layout.overflowY).toBe('auto')
    expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight)

    const recoveryHeading = journal.page.getByRole('heading', {
      name: 'Can’t remember your PIN?'
    })
    const headingBounds = await recoveryHeading.boundingBox()
    expect(headingBounds, 'Recovery heading should have layout bounds').not.toBeNull()
    expect(headingBounds!.y).toBeGreaterThanOrEqual(0)

    const backToPin = journal.page.getByRole('button', { name: 'Back to PIN' })
    await backToPin.scrollIntoViewIfNeeded()
    const backBounds = await backToPin.boundingBox()
    expect(backBounds, 'Back to PIN should have layout bounds').not.toBeNull()
    expect(backBounds!.y).toBeGreaterThanOrEqual(0)
    expect(backBounds!.y + backBounds!.height).toBeLessThanOrEqual(560)
  } finally {
    await stopJournal(application)
    await removeUserData(userData)
  }
})

test('keeps release colors readable and removes nonessential motion when requested', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'inkprompts-accessibility-e2e-'))
  let application: ElectronApplication | undefined

  try {
    const journal = await launchJournal(userData)
    application = journal.application

    for (const theme of ['light', 'dark'] as const) {
      const ratios = await journal.page.evaluate((selectedTheme) => {
        document.documentElement.dataset.theme = selectedTheme
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        const probe = document.createElement('span')
        document.body.append(probe)
        const rgb = (variable: string): [number, number, number] => {
          probe.style.color = `var(${variable})`
          context.fillStyle = getComputedStyle(probe).color
          context.fillRect(0, 0, 1, 1)
          const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
          return [red, green, blue]
        }
        const luminance = ([red, green, blue]: [number, number, number]): number => {
          const [r, g, b] = [red, green, blue].map((channel) => {
            const normalized = channel / 255
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        const ratio = (foreground: string, background: string): number => {
          const lighter = Math.max(luminance(rgb(foreground)), luminance(rgb(background)))
          const darker = Math.min(luminance(rgb(foreground)), luminance(rgb(background)))
          return (lighter + 0.05) / (darker + 0.05)
        }
        const pairs = [
          ['--text', '--surface'],
          ['--text-muted', '--surface'],
          ['--text-subtle', '--surface'],
          ['--accent-text', '--surface'],
          ['--accent-foreground', '--accent'],
          ['--accent-strong', '--accent-soft'],
          ['--danger', '--surface'],
          ['--text', '--notebook-paper']
        ]
        const values = Object.fromEntries(
          pairs.map(([foreground, background]) => [
            `${foreground} on ${background}`,
            ratio(foreground, background)
          ])
        )
        probe.remove()
        return values
      }, theme)

      for (const [pair, ratio] of Object.entries(ratios)) {
        expect(ratio, `${theme}: ${pair}`).toBeGreaterThanOrEqual(4.5)
      }
    }

    await journal.page.emulateMedia({ reducedMotion: 'reduce' })
    const motion = await journal.page.evaluate(() => {
      const button = document.createElement('button')
      button.className = 'primary-button'
      document.body.append(button)
      const style = getComputedStyle(button)
      const values = {
        animationDuration: style.animationDuration,
        animationIterations: style.animationIterationCount,
        transitionDuration: style.transitionDuration
      }
      button.remove()
      return values
    })
    expect(motion).toEqual({
      animationDuration: '1e-05s',
      animationIterations: '1',
      transitionDuration: '1e-05s'
    })
  } finally {
    await stopJournal(application)
    await removeUserData(userData)
  }
})

test('Welcome backup restore covers cancellation, failures, success, and restart', async () => {
  const testDirectory = await mkdtemp(join(tmpdir(), 'inkprompts-welcome-restore-e2e-'))
  const sourceUserData = join(testDirectory, 'source-user-data')
  const recoveryUserData = join(testDirectory, 'recovery-user-data')
  const backupPath = join(testDirectory, 'valid.inkbackup')
  const damagedPath = join(testDirectory, 'damaged.inkbackup')
  const unsupportedPath = join(testDirectory, 'unsupported.inkbackup')
  const password = 'portable-password'
  const restoredSentence = 'A sentence restored before creating a new Journal Vault.'
  let application: ElectronApplication | undefined

  try {
    const source = await launchJournal(sourceUserData)
    application = source.application
    const storage = await source.application.evaluate(({ safeStorage }) => ({
      available: safeStorage.isEncryptionAvailable(),
      backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'system'
    }))
    test.skip(
      !storage.available || storage.backend === 'basic_text',
      'Secure storage is unavailable'
    )

    await source.application.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: destination
      })) as typeof dialog.showSaveDialog
    }, backupPath)
    await source.page.getByRole('button', { name: 'Start writing' }).click()
    await source.page.getByRole('textbox', { name: 'Daily Entry body' }).fill(restoredSentence)
    await expect(source.page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
    await source.page.getByRole('button', { name: 'Settings' }).click()
    await source.page.getByLabel('Backup password', { exact: true }).fill(password)
    await source.page.getByLabel('Confirm for a new backup').fill(password)
    await source.page.getByRole('button', { name: 'Create Portable Backup' }).click()
    await expect(
      source.page.getByRole('status').filter({ hasText: 'Portable Backup created.' })
    ).toBeVisible()
    const originalBackup = await readFile(backupPath)

    await application.close()
    application = undefined

    const damagedBackup = encryptPortableBackup('not a Journal Vault', password)
    const unsupportedBackup = encryptPortableBackup(
      JSON.stringify({ schemaVersion: 999 }),
      password
    )
    await writeFile(damagedPath, damagedBackup)
    await writeFile(unsupportedPath, unsupportedBackup)

    const welcome = await launchJournal(recoveryUserData)
    application = welcome.application
    const openRestore = welcome.page.getByRole('button', { name: 'Restore a Portable Backup' })
    await openRestore.click()
    const backupPassword = welcome.page.getByLabel('Backup password', { exact: true })
    await backupPassword.fill(password)
    await welcome.page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(openRestore).toBeVisible()
    await expectManagedVaultAbsent(recoveryUserData)

    await openRestore.click()
    await backupPassword.fill(password)
    await selectPortableBackup(welcome.application, null)
    const restore = welcome.page.getByRole('button', { name: 'Choose Backup and Restore' })
    await restore.click()
    await expect(
      welcome.page
        .getByRole('status')
        .filter({ hasText: 'No backup was selected. No Journal Vault was created.' })
    ).toBeVisible()
    await expectManagedVaultAbsent(recoveryUserData)

    await selectPortableBackup(welcome.application, backupPath)
    await backupPassword.fill('wrong-password')
    await restore.click()
    await expect(welcome.page.getByRole('alert')).toHaveText(
      'The backup password is incorrect, or this Portable Backup is damaged.'
    )
    await expectManagedVaultAbsent(recoveryUserData)

    await selectPortableBackup(welcome.application, damagedPath)
    await backupPassword.fill(password)
    await restore.click()
    await expect(welcome.page.getByRole('alert')).toHaveText(
      'This Portable Backup is damaged and was not restored.'
    )
    await expectManagedVaultAbsent(recoveryUserData)

    await selectPortableBackup(welcome.application, unsupportedPath)
    await restore.click()
    await expect(welcome.page.getByRole('alert')).toHaveText(
      'This Portable Backup was created by an unsupported version.'
    )
    await expectManagedVaultAbsent(recoveryUserData)
    expect(await readFile(backupPath)).toEqual(originalBackup)
    expect(await readFile(damagedPath)).toEqual(damagedBackup)
    expect(await readFile(unsupportedPath)).toEqual(unsupportedBackup)

    await application.close()
    application = undefined

    const afterFailures = await launchJournal(recoveryUserData)
    application = afterFailures.application
    await expect(
      afterFailures.page.getByRole('heading', { name: 'InkPrompts Journal' })
    ).toBeVisible()
    await expectManagedVaultAbsent(recoveryUserData)
    await selectPortableBackup(afterFailures.application, backupPath)
    await afterFailures.page.getByRole('button', { name: 'Restore a Portable Backup' }).click()
    await afterFailures.page.getByLabel('Backup password', { exact: true }).fill(password)
    await afterFailures.page.getByRole('button', { name: 'Choose Backup and Restore' }).click()
    await expect(
      afterFailures.page.getByRole('textbox', { name: 'Daily Entry body' })
    ).toContainText(restoredSentence)

    await application.close()
    application = undefined

    const afterSuccess = await launchJournal(recoveryUserData)
    application = afterSuccess.application
    await expect(
      afterSuccess.page.getByRole('textbox', { name: 'Daily Entry body' })
    ).toContainText(restoredSentence)
  } finally {
    await stopJournal(application)
    await removeUserData(testDirectory)
  }
})

test('production renderer is isolated, offline, and restores the last acknowledged entry', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'inkprompts-e2e-'))
  const backupPath = join(userData, 'portable.inkbackup')
  const exportPath = join(userData, 'journal.md')
  let application: ElectronApplication | undefined
  const requests: string[] = []
  const confirmations: string[] = []

  try {
    const first = await launchJournal(userData, requests)
    application = first.application

    await expect(first.page).toHaveTitle('InkPrompts Journal')
    const storage = await first.application.evaluate(({ safeStorage }) => ({
      available: safeStorage.isEncryptionAvailable(),
      backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'system'
    }))
    expect(
      await first.page.evaluate(() => ({
        process: typeof window.process,
        require: typeof window.require,
        api: Object.keys(window.journal).sort()
      }))
    ).toEqual({
      process: 'undefined',
      require: 'undefined',
      api: [
        'bootstrap',
        'clearForgottenPin',
        'completeToday',
        'configurePin',
        'createPortableBackup',
        'deleteEntry',
        'disablePin',
        'dismissHabitRecipeInvite',
        'eraseJournalVault',
        'exportJournal',
        'getAppInfo',
        'listDeviceSnapshots',
        'lock',
        'onFlushRequested',
        'onLocked',
        'openDate',
        'openExternalPage',
        'restoreDeviceSnapshot',
        'restorePortableBackup',
        'saveEntry',
        'saveHabitRecipe',
        'search',
        'setHabitRecipeEnabled',
        'startWriting',
        'unlock',
        'updatePreferences'
      ]
    })
    await expect(first.page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
      'content',
      /connect-src 'none'/
    )

    if (!storage.available || storage.backend === 'basic_text') {
      await expect(first.page.getByRole('alert')).toContainText('will not create a plaintext vault')
      await expectNoNetworkRequests(first.application, requests)
      return
    }

    await expect(first.page.getByRole('heading', { name: 'InkPrompts Journal' })).toBeVisible()
    await expect(first.page.locator('.welcome-visual img')).toHaveAttribute(
      'src',
      /^data:image\/svg\+xml/
    )
    await expect(first.page.locator('.welcome-visual img')).toHaveAttribute('alt', '')
    const startWriting = first.page.getByRole('button', { name: 'Start writing' })
    await first.page.keyboard.press('Tab')
    await expect(startWriting).toBeFocused()
    await startWriting.press('Enter')

    const body = first.page.getByRole('textbox', { name: 'Daily Entry body' })
    await expect(body).toBeFocused()
    await expect(
      first.page.getByRole('status').filter({ hasText: /^Not saved yet$/ })
    ).toBeVisible()
    await body.press('ControlOrMeta+b')
    await body.pressSequentially('A durable sentence written without a network.')
    await expect(body.locator('strong')).toContainText(
      'A durable sentence written without a network.'
    )
    await body.press('ControlOrMeta+b')
    await body.press('Enter')
    await body.pressSequentially('Still here.')
    await expect(body).toContainText('Still here.')
    await expect(
      first.page.getByRole('status', { name: '' }).filter({ hasText: /^Saved$/ })
    ).toBeVisible()

    const calendar = first.page.getByRole('region', { name: 'Journal calendar' })
    const previousMonth = calendar.getByRole('button', { name: 'Previous month' })
    await previousMonth.click()
    const pastDate = calendar.getByRole('button').nth(2)
    await pastDate.click()
    await expect(first.page.getByText('Daily Entry', { exact: true })).toBeVisible()
    const today = first.page.getByRole('button', { name: 'Today', exact: true })
    await today.click()
    await expect(body).toContainText('A durable sentence written without a network.')
    await expectNoNetworkRequests(first.application, requests)

    await application.close()
    application = undefined

    const restarted = await launchJournal(userData, requests)
    application = restarted.application
    restarted.page.on('dialog', (dialog) => {
      confirmations.push(dialog.message())
      void dialog.accept()
    })
    await restarted.application.evaluate(
      ({ dialog, shell }, paths) => {
        const state = globalThis as typeof globalThis & { inkpromptsOpenedUrls?: string[] }
        state.inkpromptsOpenedUrls = []
        dialog.showSaveDialog = (async (...args: unknown[]) => {
          const options = args.at(-1) as { defaultPath?: string }
          return {
            canceled: false,
            filePath: options.defaultPath?.endsWith('.inkbackup') ? paths.backup : paths.export
          }
        }) as typeof dialog.showSaveDialog
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [paths.backup]
        })) as typeof dialog.showOpenDialog
        shell.openExternal = (async (url: string) => {
          state.inkpromptsOpenedUrls!.push(url)
        }) as typeof shell.openExternal
      },
      { backup: backupPath, export: exportPath }
    )
    await expect(restarted.page.getByRole('textbox', { name: 'Daily Entry body' })).toContainText(
      'A durable sentence written without a network.'
    )

    const done = restarted.page.getByRole('button', { name: 'Done for Today' })
    await expect(done).toBeEnabled()
    await done.click()
    await expect(restarted.page.getByText('Saved. One sentence counts.')).toBeVisible()
    const createHabitRecipe = restarted.page.getByRole('button', {
      name: 'Create a Habit Recipe'
    })
    await expect(createHabitRecipe).toBeFocused()
    await restarted.page.keyboard.press('Tab')
    const notNow = restarted.page.getByRole('button', { name: 'Not now' })
    await expect(notNow).toBeFocused()
    await notNow.press('Enter')
    await expect(done).toBeFocused()

    const search = restarted.page.getByPlaceholder('Search your journal')
    await search.fill('durable sentence')
    await expect(restarted.page.getByRole('status').filter({ hasText: '1 result' })).toBeVisible()

    const malformedRequest = await restarted.page.evaluate(async () => {
      try {
        await (window.journal.saveEntry as unknown as (input: null) => Promise<unknown>)(null)
        return 'unexpected success'
      } catch (error) {
        return (error as Error).message
      }
    })
    expect(malformedRequest).toBe('The renderer request had an invalid shape.')

    const settings = restarted.page.getByRole('button', { name: 'Settings' })
    await settings.click()
    const closeSettings = restarted.page.getByRole('button', { name: 'Close Settings' })
    await expect(closeSettings).toBeFocused()
    await expect(restarted.page.getByText('InkPrompts Journal 1.0.0')).toBeVisible()
    await expect(restarted.page.getByText('Private and offline')).toBeVisible()
    const theme = restarted.page.getByLabel('Theme')
    await theme.focus()
    await expect(theme).toBeFocused()
    await theme.selectOption('dark')
    await expect
      .poll(() => restarted.page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('dark')

    const spellcheckOption = restarted.page
      .getByText('Use native spellcheck', { exact: true })
      .locator('..')
    const themeBounds = await theme.boundingBox()
    const spellcheckBounds = await spellcheckOption.boundingBox()
    expect(themeBounds, 'Theme should have layout bounds').not.toBeNull()
    expect(spellcheckBounds, 'Native spellcheck should have layout bounds').not.toBeNull()
    expect(Math.abs(spellcheckBounds!.y - themeBounds!.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(spellcheckBounds!.height - themeBounds!.height)).toBeLessThanOrEqual(1)

    const pinWarning = restarted.page.getByRole('note', { name: 'PIN recovery warning' })
    await expect(pinWarning).toContainText('Your PIN cannot be recovered or reset.')
    await expect(pinWarning).toContainText('Create a Portable Backup before enabling PIN Lock.')

    const backupPassword = restarted.page.getByLabel('Backup password', { exact: true })
    await backupPassword.fill('portable-password')
    const backupConfirmation = restarted.page.getByLabel('Confirm for a new backup')
    await backupConfirmation.fill('portable-password')
    const createBackup = restarted.page.getByRole('button', { name: 'Create Portable Backup' })
    await createBackup.click()
    await expect(
      restarted.page.getByRole('status').filter({ hasText: 'Portable Backup created.' })
    ).toBeVisible()

    const exportMarkdown = restarted.page.getByRole('button', { name: 'Export Markdown' })
    await exportMarkdown.click()
    await expect(
      restarted.page.getByRole('status').filter({ hasText: 'MARKDOWN export saved.' })
    ).toBeVisible()
    expect((await readFile(backupPath)).byteLength).toBeGreaterThan(100)
    expect(await readFile(exportPath, 'utf8')).toContain(
      '**A durable sentence written without a network.**'
    )

    await closeSettings.click()
    await expect(settings).toBeFocused()
    const restartedBody = restarted.page.getByRole('textbox', { name: 'Daily Entry body' })
    await restartedBody.fill('Changed after the Portable Backup.')
    await expect(restarted.page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()

    await settings.click()
    await backupPassword.fill('portable-password')
    const restoreBackup = restarted.page.getByRole('button', { name: 'Restore Portable Backup' })
    await restoreBackup.click()
    await expect(
      restarted.page.getByRole('status').filter({ hasText: 'Portable Backup restored.' })
    ).toBeVisible()
    const restoreSnapshot = restarted.page
      .getByRole('listitem')
      .filter({ hasText: 'before restore' })
      .first()
      .getByRole('button', { name: /Restore snapshot from/ })
    await restoreSnapshot.click()
    await expect(
      restarted.page.getByRole('status').filter({ hasText: 'Device Snapshot restored.' })
    ).toBeVisible()

    for (const page of ['Website', 'Privacy', 'Terms', 'Support']) {
      await restarted.page.getByRole('button', { name: page, exact: true }).click()
    }
    expect(
      await restarted.application.evaluate(() => {
        const state = globalThis as typeof globalThis & { inkpromptsOpenedUrls?: string[] }
        return state.inkpromptsOpenedUrls
      })
    ).toEqual([
      'https://inkprompts.com/journal',
      'https://inkprompts.com/privacy',
      'https://inkprompts.com/terms',
      'https://inkprompts.com/contact'
    ])

    const newPin = restarted.page.getByLabel('New 6-digit PIN')
    await newPin.fill('654321')
    const confirmPin = restarted.page.getByLabel('Confirm new PIN')
    await confirmPin.fill('654321')
    const enablePin = restarted.page.getByRole('button', { name: 'Enable PIN Lock' })
    await enablePin.click()
    await expect(
      restarted.page.getByRole('status').filter({ hasText: 'PIN Lock updated.' })
    ).toBeVisible()
    await closeSettings.click()

    const unlockedForgottenPinAttempt = await restarted.page.evaluate(async () => {
      try {
        await window.journal.clearForgottenPin('DELETE MY JOURNAL VAULT')
        return { code: 'unexpected success', message: '' }
      } catch (error) {
        const journalError = error as Error & { code?: string }
        return { code: journalError.code, message: journalError.message }
      }
    })
    expect(unlockedForgottenPinAttempt).toEqual({
      code: 'INVALID_INPUT',
      message: 'Forgotten PIN erasure is available only while InkPrompts Journal is locked.'
    })

    await expect(restartedBody).toContainText('Changed after the Portable Backup.')
    const collapseSidebar = restarted.page.getByRole('button', { name: 'Collapse sidebar' })
    await collapseSidebar.click()
    const expandSidebar = restarted.page.getByRole('button', { name: 'Expand sidebar' })
    await expect(expandSidebar).toBeVisible()
    await expandSidebar.click()
    await expect(collapseSidebar).toBeVisible()

    await restarted.application.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('lock-screen')
    })
    await expect(
      restarted.page.getByRole('heading', { name: 'InkPrompts Journal is locked' })
    ).toBeVisible()
    await expect(restarted.page.getByText('Version 1.0.0')).toBeVisible()
    await expect(restarted.page.getByRole('button', { name: 'Privacy' })).toBeVisible()
    await expect(restarted.page.getByRole('button', { name: 'Support' })).toBeVisible()
    expect(await restarted.page.locator('body').innerText()).not.toContain(
      'A durable sentence written without a network.'
    )
    const lockedSearchResult = await restarted.page.evaluate(async () => {
      try {
        await window.journal.search('durable sentence')
        return { code: 'unexpected success', message: '' }
      } catch (error) {
        const journalError = error as Error & { code?: string }
        return { code: journalError.code, message: journalError.message }
      }
    })
    expect(lockedSearchResult).toEqual({
      code: 'LOCKED',
      message: 'Unlock InkPrompts Journal to continue.'
    })
    const unlockPin = restarted.page.getByLabel('PIN')
    await expect(unlockPin).toBeFocused()
    await unlockPin.fill('654321')
    await unlockPin.press('Enter')
    await expect(restarted.page.getByRole('textbox', { name: 'Daily Entry body' })).toContainText(
      'Changed after the Portable Backup.'
    )

    await settings.click()
    const erasure = restarted.page.getByRole('region', { name: 'Erase Journal Vault' })
    await erasure.getByRole('radio', { name: 'Erase without creating a backup' }).click()
    await erasure.getByLabel(/I understand unsaved writing will be destroyed/i).check()
    await erasure.getByLabel('Current PIN').fill('654321')
    await erasure.getByLabel(/Type ERASE to confirm/i).fill('ERASE')
    await erasure.getByRole('button', { name: 'Erase Journal Vault' }).click()

    await expect(restarted.page.getByRole('heading', { name: 'InkPrompts Journal' })).toBeVisible()
    for (const managedPath of ['journal.key', 'journal.vault', 'snapshots']) {
      await expect(access(join(userData, managedPath))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    expect((await readFile(backupPath)).byteLength).toBeGreaterThan(100)
    expect(await readFile(exportPath, 'utf8')).toContain(
      '**A durable sentence written without a network.**'
    )

    await restarted.page.getByRole('button', { name: 'Restore a Portable Backup' }).click()
    await restarted.page.getByLabel('Backup password', { exact: true }).fill('portable-password')
    await restarted.page.getByRole('button', { name: 'Choose Backup and Restore' }).click()
    await expect(restarted.page.getByRole('textbox', { name: 'Daily Entry body' })).toContainText(
      'A durable sentence written without a network.'
    )
    await expect(restarted.page.getByRole('button', { name: 'Lock', exact: true })).toHaveCount(0)

    await settings.click()
    await restarted.page.getByLabel('New 6-digit PIN').fill('112233')
    await restarted.page.getByLabel('Confirm new PIN').fill('112233')
    await restarted.page.getByRole('button', { name: 'Enable PIN Lock' }).click()
    await expect(
      restarted.page.getByRole('status').filter({ hasText: 'PIN Lock updated.' })
    ).toBeVisible()
    await closeSettings.click()
    await restarted.page.getByRole('button', { name: 'Lock', exact: true }).click()
    await restarted.page.getByRole('button', { name: 'I forgot my PIN' }).click()
    await restarted.page.getByRole('button', { name: 'Erase local data and start over' }).click()
    await restarted.page
      .getByLabel(/Type DELETE MY JOURNAL VAULT to confirm/i)
      .fill('DELETE MY JOURNAL VAULT')
    await restarted.page.getByRole('button', { name: 'Erase Journal Vault' }).click()
    await expect(restarted.page.getByRole('heading', { name: 'InkPrompts Journal' })).toBeVisible()
    expect((await readFile(backupPath)).byteLength).toBeGreaterThan(100)
    await expectNoNetworkRequests(restarted.application, requests)
    expect(confirmations).toEqual(
      expect.arrayContaining([
        'This ordinary export is not encrypted. Save it only somewhere you trust.',
        'Replace the current Journal Vault with a Portable Backup? A Device Snapshot will protect the current state first.'
      ])
    )
    expect(confirmations.some((message) => message.startsWith('Restore the Device Snapshot'))).toBe(
      true
    )

    const originalUrl = restarted.page.url()
    await restarted.page.evaluate(() => {
      window.open('https://example.com', '_blank')
      window.location.assign('https://example.com')
    })
    await restarted.page.waitForTimeout(250)
    expect(restarted.page.url()).toBe(originalUrl)
    await expectNoNetworkRequests(restarted.application, requests)
  } finally {
    await stopJournal(application)
    await removeUserData(userData)
  }
})
