import type { IdleLockMinutes } from '../../shared/journal-contract'

export type IdleLockActivity = 'click' | 'key' | 'input' | 'scroll' | 'mouse-move'

export interface IdleLockScheduler<Handle> {
  setTimeout(callback: () => void, delay: number): Handle
  clearTimeout(handle: Handle): void
}

export class IdleLockCoordinator<Handle> {
  private preference: IdleLockMinutes | null = null
  private locked = false
  private timer: Handle | null = null
  private readonly pauses = new Set<string>()

  constructor(
    private readonly scheduler: IdleLockScheduler<Handle>,
    private readonly onTimeout: () => void | Promise<void>,
    private readonly durationMs: (minutes: Exclude<IdleLockMinutes, 'off'>) => number = (minutes) =>
      minutes * 60_000
  ) {}

  setPreference(preference: IdleLockMinutes | null): void {
    this.preference = preference
    this.restart()
  }

  setUnlocked(): void {
    this.locked = false
    this.restart()
  }

  setLocked(): void {
    this.locked = true
    this.cancelTimer()
  }

  recordActivity(activity: IdleLockActivity): void {
    if (activity === 'mouse-move') return
    this.restart()
  }

  pause(scope: string): void {
    this.pauses.add(scope)
    this.cancelTimer()
  }

  resume(scope: string): void {
    this.pauses.delete(scope)
    this.restart()
  }

  dispose(): void {
    this.cancelTimer()
    this.pauses.clear()
  }

  private restart(): void {
    this.cancelTimer()
    if (
      this.locked ||
      this.pauses.size > 0 ||
      this.preference === null ||
      this.preference === 'off'
    ) {
      return
    }
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null
      this.locked = true
      void this.onTimeout()
    }, this.durationMs(this.preference))
  }

  private cancelTimer(): void {
    if (this.timer === null) return
    this.scheduler.clearTimeout(this.timer)
    this.timer = null
  }
}
