import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import './editor-theme.css' // our overrides — must load after the theme
import { isImageHostConfigured, uploadImage } from '../lib/imageHost'
import { stripEmptyLineBreaks } from '../lib/markdown'
import { aiProvider, AiNotConfiguredError } from '../lib/ai'
import { selectAllAsText } from '../lib/editorPlugins'
import { getAiPrompts } from '../lib/storage'

export interface EditorHandle {
  getMarkdown: () => string
}

interface EditorProps {
  /** Initial content, loaded once on mount. */
  defaultValue: string
  /** Place the cursor in the editor once it's ready. Read on mount — the app
   *  remounts the editor per opened file, so this focuses that fresh mount. */
  autoFocus?: boolean
  /** Called (debounced by Milkdown) whenever the markdown changes. */
  onChange?: (markdown: string) => void
  /** Called when an image upload is attempted but no image host is configured,
   *  so the app can offer to configure one (or go Pro). */
  onImageUploadUnconfigured?: () => void
  /** Called when an image upload fails, so the app can surface the error. */
  onImageUploadError?: (message: string) => void
  /** Called when the AI toolbar action is used but no AI provider is configured,
   *  so the app can offer to configure one. */
  onAiUnconfigured?: () => void
  /** Called when an AI request fails, so the app can surface the error. */
  onAiError?: (message: string) => void
  /** Called from the "Edit prompts" link in the AI palette, so the app can open
   *  the prompts editor. */
  onEditPrompts?: () => void
  ref?: Ref<EditorHandle>
}

export function Editor({
  defaultValue,
  autoFocus,
  onChange,
  onImageUploadUnconfigured,
  onImageUploadError,
  onAiUnconfigured,
  onAiError,
  onEditPrompts,
  ref,
}: EditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)

  // Keep the latest callbacks without forcing the editor to re-create.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  const onUnconfiguredRef = useRef(onImageUploadUnconfigured)
  useEffect(() => {
    onUnconfiguredRef.current = onImageUploadUnconfigured
  }, [onImageUploadUnconfigured])
  const onUploadErrorRef = useRef(onImageUploadError)
  useEffect(() => {
    onUploadErrorRef.current = onImageUploadError
  }, [onImageUploadError])
  const onAiUnconfiguredRef = useRef(onAiUnconfigured)
  useEffect(() => {
    onAiUnconfiguredRef.current = onAiUnconfigured
  }, [onAiUnconfigured])
  const onAiErrorRef = useRef(onAiError)
  useEffect(() => {
    onAiErrorRef.current = onAiError
  }, [onAiError])
  const onEditPromptsRef = useRef(onEditPrompts)
  useEffect(() => {
    onEditPromptsRef.current = onEditPrompts
  }, [onEditPrompts])

  useImperativeHandle(ref, () => ({
    // Exported Markdown is normalized; the live draft (persisted from the
    // markdownUpdated stream) keeps Milkdown's blank-line round-trip.
    getMarkdown: () => stripEmptyLineBreaks(crepeRef.current?.getMarkdown() ?? ''),
  }))

  useEffect(() => {
    if (!rootRef.current) return

    // Upload picked/pasted images to the configured image host and return the
    // raw URL for the editor to embed. With no host configured, prompt the user
    // (configure one, or go Pro) and insert nothing.
    const blockUpload = async (file: File): Promise<string> => {
      if (!isImageHostConfigured()) {
        onUnconfiguredRef.current?.()
        return ''
      }
      try {
        return await uploadImage(file)
      } catch (err) {
        onUploadErrorRef.current?.(err instanceof Error ? err.message : String(err))
        return ''
      }
    }

    // The "Upload file" control is a <label class="uploader"> that opens the OS
    // file picker. When there's no host yet, catch the click in the capture
    // phase so we prompt *before* the picker opens instead of after a file is
    // chosen. When a host is configured, let the picker open and the chosen
    // file flow into blockUpload above.
    const root = rootRef.current
    const onUploaderClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('.uploader') && !isImageHostConfigured()) {
        e.preventDefault()
        e.stopPropagation()
        onUnconfiguredRef.current?.()
      }
    }
    root.addEventListener('click', onUploaderClick, true)

    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue,
      // Enable the AI feature: adds a ✨ action to the selection toolbar that
      // lets the user instruct AI to revise the selected passage (streamed in
      // as a diff to accept/reject). Disabled by default in Crepe.
      features: {
        [Crepe.Feature.AI]: true,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: 'Input here, publish anywhere.',
          mode: 'doc', // only when the whole doc is empty, not on every blank line
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: blockUpload,
          inlineOnUpload: blockUpload,
          blockOnUpload: blockUpload,
          inlineUploadPlaceholderText: 'Paste image link',
          blockUploadPlaceholderText: 'Paste image link',
        },
        [Crepe.Feature.AI]: {
          provider: aiProvider,
          instructionPlaceholder: 'Ask AI to revise the selection…',
          // Replace Crepe's built-in suggestions (which include the elaborate
          // tone/translate submenus) with the user's own editable prompts.
          // Read once at mount; App remounts the editor when prompts change.
          buildAISuggestions: (builder) => {
            builder.clear()
            for (const p of getAiPrompts()) {
              builder.addItem(p.id, { icon: '', label: p.label, prompt: p.prompt })
            }
          },
          // The provider throws AiNotConfiguredError (wrapped as error.cause)
          // when no provider is set up — prompt to configure instead of showing
          // an opaque failure. Any other error surfaces as a toast.
          onError: (error) => {
            if (error.cause instanceof AiNotConfiguredError) {
              onAiUnconfiguredRef.current?.()
            } else {
              onAiErrorRef.current?.(error.cause instanceof Error ? error.cause.message : error.message)
            }
          },
        },
      },
    })
    // Make Cmd/Ctrl+A select the whole doc as a text selection, so the toolbar
    // (style + AI rewrite) shows for a full-document selection too.
    crepe.editor.use(selectAllAsText)

    crepe.on((api) => {
      api.markdownUpdated((_, markdown) => onChangeRef.current?.(markdown))
    })

    // Add an "Edit prompts" footer inside the AI instruction palette. Crepe's UI
    // is a Vue app; the palette card (`.ai-instruction`) is Vue-owned, so we
    // append our footer to it. A persistent observer re-injects whenever the
    // current link becomes detached — which covers Vue re-renders that replace
    // the card, and the StrictMode dev double-mount (where the first editor's
    // palette is briefly still in the DOM when the second one mounts). Clicking
    // bridges back to React to open the prompts editor.
    const ensureEditLink = () => {
      const existing = root.querySelector('.inputpub-edit-prompts')
      if (existing?.isConnected) return
      const card = root.querySelector('.milkdown-ai-instruction .ai-instruction')
      if (!card) return
      const link = document.createElement('button')
      link.type = 'button'
      link.className = 'inputpub-edit-prompts'
      // Pencil icon + label (matches the EditIcon used in the menu).
      link.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 20h9"/>' +
        '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
        '<span>Edit prompts</span>'
      // Keep the editor selection (don't blur/close the palette before the click).
      link.addEventListener('mousedown', (e) => e.preventDefault())
      link.addEventListener('click', () => onEditPromptsRef.current?.())
      card.appendChild(link)
    }

    let destroyed = false
    let linkObserver: MutationObserver | undefined
    crepe.create().then(() => {
      if (destroyed) {
        crepe.destroy()
        return
      }
      crepeRef.current = crepe
      // Place the cursor in the doc so the user can type immediately (e.g. right
      // after opening a file). ProseMirror focus lands the caret at the start.
      if (autoFocus) (root.querySelector('.ProseMirror') as HTMLElement | null)?.focus()
      ensureEditLink()
      // ensureEditLink early-returns once the link is present and connected, so
      // this is a cheap querySelector per mutation batch.
      linkObserver = new MutationObserver(ensureEditLink)
      linkObserver.observe(root, { childList: true, subtree: true })
    })

    return () => {
      destroyed = true
      linkObserver?.disconnect()
      root.removeEventListener('click', onUploaderClick, true)
      crepeRef.current = null
      crepe.destroy()
    }
    // defaultValue is intentionally read once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fill the sheet so the whole page is a writing surface (the inner .milkdown
  // / .ProseMirror fill rules live in editor-theme.css, since Crepe injects
  // that DOM itself).
  return <div className="flex min-w-0 flex-1 flex-col" ref={rootRef} />
}
