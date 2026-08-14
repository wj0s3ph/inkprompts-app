export interface RichTextMark {
  type: 'bold' | 'italic' | 'link'
  attrs?: { href: string }
}

export interface RichTextNode {
  type: 'paragraph' | 'bulletList' | 'orderedList' | 'listItem' | 'blockquote' | 'text'
  text?: string
  marks?: RichTextMark[]
  content?: RichTextNode[]
}

export interface RichTextDocument {
  type: 'doc'
  version: 1
  content: RichTextNode[]
}

export interface DailyEntry {
  date: string
  title: string
  content: RichTextDocument
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface JournalHistoryItem {
  date: string
  title: string | null
  snippet: string
  empty: boolean
}

export interface TextMatchRange {
  start: number
  end: number
}

export interface JournalSearchResult {
  date: string
  title: string | null
  snippet: string
  titleMatches: TextMatchRange[]
  snippetMatches: TextMatchRange[]
}

export interface SaveEntryInput {
  date: string
  title: string
  content: RichTextDocument
}

export interface SaveEntryResult {
  status: 'saved'
  entry: DailyEntry | null
  entryDates: string[]
}

export type IdleLockMinutes = 'off' | 5 | 15 | 30 | 60

export interface JournalPreferences {
  theme: 'system' | 'light' | 'dark'
  spellcheck: boolean
  idleLockMinutes: IdleLockMinutes | null
}

export interface CompleteTodayResult {
  celebrated: boolean
  message: 'Saved. One sentence counts.' | null
  recipePrompt: 'invite' | 'review' | null
  entry: DailyEntry
}

export interface HabitRecipe {
  anchor: string
  enabled: boolean
  sentence: string
  createdAt: string
  updatedAt: string
}

export type DeviceSnapshotReason = 'daily' | 'before-delete' | 'before-restore'

export interface DeviceSnapshotMetadata {
  id: string
  createdAt: string
  reason: DeviceSnapshotReason
  deviceBound: true
}

export const emptyRichTextDocument = (): RichTextDocument => ({
  type: 'doc',
  version: 1,
  content: [{ type: 'paragraph' }]
})

export function richTextToPlainText(document: RichTextDocument): string {
  const parts: string[] = []

  const visit = (nodes: RichTextNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'text' && node.text) parts.push(node.text)
      if (node.content) visit(node.content)
      if (node.type !== 'text') parts.push('\n')
    }
  }

  visit(document.content)
  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function assertRichTextDocument(value: unknown): asserts value is RichTextDocument {
  if (!value || typeof value !== 'object') throw new Error('INVALID_CONTENT')
  const document = value as Partial<RichTextDocument>
  if (document.type !== 'doc' || document.version !== 1 || !Array.isArray(document.content)) {
    throw new Error('INVALID_CONTENT')
  }
  assertNodes(document.content, { nodes: 0, characters: 0 }, 0)
}

interface RichTextBudget {
  nodes: number
  characters: number
}

function assertNodes(nodes: unknown[], budget: RichTextBudget, depth: number): void {
  if (depth > 100) throw new Error('CONTENT_TOO_DEEP')
  const nodeTypes = new Set([
    'paragraph',
    'bulletList',
    'orderedList',
    'listItem',
    'blockquote',
    'text'
  ])
  const markTypes = new Set(['bold', 'italic', 'link'])

  for (const value of nodes) {
    budget.nodes += 1
    if (budget.nodes > 50_000) throw new Error('CONTENT_TOO_LARGE')
    if (!value || typeof value !== 'object') throw new Error('INVALID_CONTENT')
    const node = value as Partial<RichTextNode>
    if (!node.type || !nodeTypes.has(node.type)) throw new Error('INVALID_CONTENT')
    if (node.type === 'text' && typeof node.text !== 'string') throw new Error('INVALID_CONTENT')
    if (node.text) {
      budget.characters += node.text.length
      if (budget.characters > 2_000_000) throw new Error('CONTENT_TOO_LARGE')
    }
    if (node.marks) {
      if (!Array.isArray(node.marks)) throw new Error('INVALID_CONTENT')
      for (const mark of node.marks) {
        if (!markTypes.has(mark.type)) throw new Error('INVALID_CONTENT')
        if (mark.type === 'link') {
          const href = mark.attrs?.href
          if (!href || href.length > 2_048 || !/^https?:\/\//i.test(href)) {
            throw new Error('INVALID_CONTENT')
          }
        }
      }
    }
    if (node.content) {
      if (!Array.isArray(node.content)) throw new Error('INVALID_CONTENT')
      assertNodes(node.content, budget, depth + 1)
    }
  }
}
