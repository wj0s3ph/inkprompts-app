import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2
} from 'lucide-react'
import type { RichTextDocument, RichTextNode } from '../../../shared/journal-contract'

interface RichTextEditorProps {
  content: RichTextDocument
  editable: boolean
  autoFocus: boolean
  suspended: boolean
  focusKey: string
  placeholder?: string
  spellcheck: boolean
  onChange(content: RichTextDocument): void
}

export function RichTextEditor({
  content,
  editable,
  autoFocus,
  suspended,
  focusKey,
  placeholder,
  spellcheck,
  onChange
}: RichTextEditorProps): React.JSX.Element {
  const restoreFocusRef = useRef(false)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        hardBreak: false,
        heading: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: { openOnClick: false, autolink: true, protocols: ['http', 'https'] }
      })
    ],
    content,
    editable,
    editorProps: {
      attributes: {
        'aria-label': 'Daily Entry body',
        class: 'journal-prose',
        role: 'textbox',
        spellcheck: String(spellcheck)
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      const value = currentEditor.getJSON()
      onChange({
        type: 'doc',
        version: 1,
        content: (value.content ?? []) as RichTextNode[]
      })
    }
  })

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  useEffect(() => {
    if (!editor) return
    if (suspended) {
      restoreFocusRef.current = editor.isFocused
      editor.commands.blur()
      return
    }
    if (!restoreFocusRef.current) return
    restoreFocusRef.current = false
    const frame = window.requestAnimationFrame(() => editor.commands.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [editor, suspended])

  useEffect(() => {
    if (!editor || !editable || !autoFocus) return
    const frame = window.requestAnimationFrame(() => editor.commands.focus('start'))
    return () => window.cancelAnimationFrame(frame)
  }, [autoFocus, editable, editor, focusKey])

  useEffect(() => {
    if (!editor) return
    const current = editor.getJSON()
    if (
      JSON.stringify({
        type: 'doc',
        version: 1,
        content: current.content ?? []
      }) === JSON.stringify(content)
    ) {
      return
    }
    editor.commands.setContent(content, { emitUpdate: false })
  }, [content, editor])

  useEffect(() => {
    if (!editor) return
    editor.setOptions({
      editorProps: {
        attributes: {
          'aria-label': 'Daily Entry body',
          class: 'journal-prose',
          role: 'textbox',
          spellcheck: String(spellcheck)
        }
      }
    })
  }, [editor, spellcheck])

  const setLink = (): void => {
    if (!editor) return
    const existing = editor.getAttributes('link').href as string | undefined
    const href = window.prompt('Link URL (https://…)', existing ?? 'https://')
    if (href === null) return
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    try {
      const url = new URL(href)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
      editor.chain().focus().extendMarkRange('link').setLink({ href: url.toString() }).run()
    } catch {
      window.alert('Use a valid http or https link.')
    }
  }

  const toolbarButton = (
    label: string,
    icon: React.ReactNode,
    active: boolean,
    action: () => void,
    disabled = false
  ): React.JSX.Element => (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`toolbar-button ${active ? 'toolbar-button-active' : ''}`}
      disabled={!editable || disabled}
      type="button"
      onClick={action}
    >
      {icon}
    </button>
  )

  return (
    <div className="journal-rich-editor">
      <div aria-label="Formatting tools" className="journal-toolbar" role="toolbar">
        {toolbarButton(
          'Bold',
          <Bold aria-hidden="true" size={18} />,
          Boolean(editor?.isActive('bold')),
          () => editor?.chain().focus().toggleBold().run()
        )}
        {toolbarButton(
          'Italic',
          <Italic aria-hidden="true" size={18} />,
          Boolean(editor?.isActive('italic')),
          () => editor?.chain().focus().toggleItalic().run()
        )}
        {toolbarButton(
          'Bulleted list',
          <List aria-hidden="true" size={18} />,
          Boolean(editor?.isActive('bulletList')),
          () => editor?.chain().focus().toggleBulletList().run()
        )}
        {toolbarButton(
          'Numbered list',
          <ListOrdered aria-hidden="true" size={18} />,
          Boolean(editor?.isActive('orderedList')),
          () => editor?.chain().focus().toggleOrderedList().run()
        )}
        {toolbarButton(
          'Block quote',
          <Quote aria-hidden="true" size={18} />,
          Boolean(editor?.isActive('blockquote')),
          () => editor?.chain().focus().toggleBlockquote().run()
        )}
        {toolbarButton(
          'Link',
          <LinkIcon aria-hidden="true" size={18} />,
          Boolean(editor?.isActive('link')),
          setLink
        )}
        <span aria-hidden="true" className="mx-1 w-px bg-[var(--border)]" />
        {toolbarButton(
          'Undo',
          <Undo2 aria-hidden="true" size={18} />,
          false,
          () => editor?.chain().focus().undo().run(),
          !editor?.can().undo()
        )}
        {toolbarButton(
          'Redo',
          <Redo2 aria-hidden="true" size={18} />,
          false,
          () => editor?.chain().focus().redo().run(),
          !editor?.can().redo()
        )}
      </div>
      <div className="journal-writing-lines">
        <EditorContent editor={editor} />
        {placeholder ? (
          <p aria-hidden="true" className="journal-writing-placeholder">
            {placeholder}
          </p>
        ) : null}
      </div>
    </div>
  )
}
