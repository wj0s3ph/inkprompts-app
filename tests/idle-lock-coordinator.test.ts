import { describe, expect, test, vi } from 'vitest'
import { IdleLockCoordinator } from '../src/main/application/idle-lock-coordinator'

class TestScheduler {
  now = 0
  private nextId = 0
  private tasks = new Map<number, { at: number; callback(): void }>()

  setTimeout(callback: () => void, delay: number): number {
    const id = ++this.nextId
    this.tasks.set(id, { at: this.now + delay, callback })
    return id
  }

  clearTimeout(id: number): void {
    this.tasks.delete(id)
  }

  advance(milliseconds: number): void {
    const target = this.now + milliseconds
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0]
      if (!next) break
      this.tasks.delete(next[0])
      this.now = next[1].at
      next[1].callback()
    }
    this.now = target
  }
}

describe('Idle Lock coordinator', () => {
  test.each([5, 15, 30, 60] as const)('locks after %i inactive minutes', (minutes) => {
    const scheduler = new TestScheduler()
    const lock = vi.fn()
    const coordinator = new IdleLockCoordinator(scheduler, lock)

    coordinator.setPreference(minutes)
    scheduler.advance(minutes * 60_000 - 1)
    expect(lock).not.toHaveBeenCalled()
    scheduler.advance(1)
    expect(lock).toHaveBeenCalledOnce()
  })

  test('resets only for trusted in-app activity and keeps running in the background', () => {
    const scheduler = new TestScheduler()
    const lock = vi.fn()
    const coordinator = new IdleLockCoordinator(scheduler, lock)
    coordinator.setPreference(5)

    scheduler.advance(4 * 60_000)
    coordinator.recordActivity('mouse-move')
    scheduler.advance(60_000)
    expect(lock).toHaveBeenCalledOnce()

    coordinator.setUnlocked()
    scheduler.advance(4 * 60_000)
    coordinator.recordActivity('click')
    scheduler.advance(4 * 60_000)
    expect(lock).toHaveBeenCalledOnce()
    scheduler.advance(60_000)
    expect(lock).toHaveBeenCalledTimes(2)
  })

  test('pause scopes suspend the timer and resume from a full interval', () => {
    const scheduler = new TestScheduler()
    const lock = vi.fn()
    const coordinator = new IdleLockCoordinator(scheduler, lock)
    coordinator.setPreference(5)

    scheduler.advance(4 * 60_000)
    coordinator.pause('file-dialog')
    scheduler.advance(20 * 60_000)
    expect(lock).not.toHaveBeenCalled()
    coordinator.resume('file-dialog')
    scheduler.advance(5 * 60_000 - 1)
    expect(lock).not.toHaveBeenCalled()
    scheduler.advance(1)
    expect(lock).toHaveBeenCalledOnce()
  })

  test('Off, disabled PIN and locked state never leave a timer armed', () => {
    const scheduler = new TestScheduler()
    const lock = vi.fn()
    const coordinator = new IdleLockCoordinator(scheduler, lock)

    coordinator.setPreference('off')
    scheduler.advance(24 * 60 * 60_000)
    coordinator.setPreference(5)
    coordinator.setLocked()
    scheduler.advance(5 * 60_000)
    coordinator.setPreference(null)
    coordinator.setUnlocked()
    scheduler.advance(24 * 60 * 60_000)
    expect(lock).not.toHaveBeenCalled()
  })
})
