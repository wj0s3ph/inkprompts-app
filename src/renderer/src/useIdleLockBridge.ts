import { useEffect } from 'react'
import type { JournalApi } from '../../preload/index'
import type { IdleLockMinutes } from '../../shared/journal-contract'

export function useIdleLockBridge(
  api: JournalApi | null,
  preference: IdleLockMinutes | null | undefined
): void {
  useEffect(() => {
    if (!api || preference === undefined) return
    api.setIdleLock(preference)
  }, [api, preference])

  useEffect(() => {
    if (!api) return
    const report = (event: Event): void => {
      if (event.isTrusted) api.reportActivity()
    }
    const eventNames = ['click', 'keydown', 'input', 'scroll'] as const
    for (const eventName of eventNames) document.addEventListener(eventName, report, true)

    const originalConfirm = window.confirm.bind(window)
    const originalPrompt = window.prompt.bind(window)
    const originalAlert = window.alert.bind(window)
    const withPausedTimer = <Result>(operation: () => Result): Result => {
      api.pauseIdleLock('native-message')
      try {
        return operation()
      } finally {
        api.resumeIdleLock('native-message')
      }
    }
    window.confirm = (...args): boolean => withPausedTimer(() => originalConfirm(...args))
    window.prompt = (...args): string | null => withPausedTimer(() => originalPrompt(...args))
    window.alert = (...args): void => withPausedTimer(() => originalAlert(...args))

    return () => {
      for (const eventName of eventNames) document.removeEventListener(eventName, report, true)
      window.confirm = originalConfirm
      window.prompt = originalPrompt
      window.alert = originalAlert
    }
  }, [api])
}
