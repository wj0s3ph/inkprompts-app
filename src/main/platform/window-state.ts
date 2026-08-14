import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow, Display, Rectangle } from 'electron'
import writeFileAtomic from 'write-file-atomic'

interface WindowState {
  version: 1
  bounds: Rectangle
  maximized: boolean
}

const fileName = 'display-preferences.json'

export async function loadWindowState(dataDirectory: string): Promise<WindowState | null> {
  try {
    const value = JSON.parse(await readFile(join(dataDirectory, fileName), 'utf8')) as unknown
    return isWindowState(value) ? value : null
  } catch {
    return null
  }
}

export function visibleWindowBounds(
  bounds: Rectangle,
  displays: Display[],
  primaryDisplay: Display,
  minimum: { width: number; height: number }
): Rectangle {
  const bestDisplay = displays
    .map((candidate) => ({ candidate, area: intersectionArea(bounds, candidate.workArea) }))
    .sort((left, right) => right.area - left.area)[0]
  const display = bestDisplay && bestDisplay.area > 0 ? bestDisplay.candidate : primaryDisplay
  const workArea = display.workArea
  const width = Math.min(Math.max(bounds.width, minimum.width), workArea.width)
  const height = Math.min(Math.max(bounds.height, minimum.height), workArea.height)
  return {
    x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(bounds.y, workArea.y, workArea.y + workArea.height - height),
    width,
    height
  }
}

export class WindowStateController {
  private state: WindowState
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly window: BrowserWindow,
    private readonly dataDirectory: string,
    initialState: WindowState
  ) {
    this.state = initialState
    const capture = (): void => this.captureAndSchedule()
    window.on('move', capture)
    window.on('resize', capture)
    window.on('maximize', capture)
    window.on('unmaximize', capture)
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.capture()
    await this.persist()
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private captureAndSchedule(): void {
    this.capture()
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.persist().catch(() => undefined)
    }, 200)
  }

  private capture(): void {
    if (this.window.isDestroyed() || this.window.isFullScreen()) return
    this.state = {
      version: 1,
      bounds: this.window.getNormalBounds(),
      maximized: this.window.isMaximized()
    }
  }

  private async persist(): Promise<void> {
    await writeFileAtomic(join(this.dataDirectory, fileName), JSON.stringify(this.state), {
      encoding: 'utf8',
      fsync: true,
      mode: 0o600
    })
  }
}

function isWindowState(value: unknown): value is WindowState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WindowState>
  return (
    candidate.version === 1 &&
    typeof candidate.maximized === 'boolean' &&
    isRectangle(candidate.bounds)
  )
}

function isRectangle(value: unknown): value is Rectangle {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Rectangle>
  return (
    Number.isFinite(candidate.x) &&
    Number.isFinite(candidate.y) &&
    Number.isFinite(candidate.width) &&
    Number.isFinite(candidate.height) &&
    candidate.width! > 0 &&
    candidate.height! > 0
  )
}

function intersectionArea(left: Rectangle, right: Rectangle): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  )
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  )
  return width * height
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
