import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import './editor-theme.css' // our overrides — must load after the theme

export interface EditorHandle {
  getMarkdown: () => string
}

interface EditorProps {
  /** Initial content, loaded once on mount. */
  defaultValue: string
  /** Called (debounced by Milkdown) whenever the markdown changes. */
  onChange?: (markdown: string) => void
  /** Called when the user tries to upload a local image file (upload is
   *  intentionally disabled — they should paste an image URL instead). */
  onImageUploadAttempt?: () => void
  ref?: Ref<EditorHandle>
}

export function Editor({ defaultValue, onChange, onImageUploadAttempt, ref }: EditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)

  // Keep the latest callbacks without forcing the editor to re-create.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  const onUploadAttemptRef = useRef(onImageUploadAttempt)
  useEffect(() => {
    onUploadAttemptRef.current = onImageUploadAttempt
  }, [onImageUploadAttempt])

  useImperativeHandle(ref, () => ({
    getMarkdown: () => crepeRef.current?.getMarkdown() ?? '',
  }))

  useEffect(() => {
    if (!rootRef.current) return

    // Local image upload is intentionally disabled: there's no backend to host
    // the file. Intercept every upload path (button, drag, paste) to show a
    // notice, and steer the user to paste an image URL instead — which already
    // works via the image block's URL field.
    const blockUpload = async (): Promise<string> => {
      onUploadAttemptRef.current?.()
      return ''
    }

    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: 'Input here. Hit Publish to send anywhere.',
          mode: 'doc', // only when the whole doc is empty, not on every blank line
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: blockUpload,
          inlineOnUpload: blockUpload,
          blockOnUpload: blockUpload,
          inlineUploadPlaceholderText: 'Paste image link',
          blockUploadPlaceholderText: 'Paste image link',
        },
      },
    })
    crepe.on((api) => {
      api.markdownUpdated((_, markdown) => onChangeRef.current?.(markdown))
    })

    let destroyed = false
    crepe.create().then(() => {
      if (destroyed) crepe.destroy()
      else crepeRef.current = crepe
    })

    return () => {
      destroyed = true
      crepeRef.current = null
      crepe.destroy()
    }
    // defaultValue is intentionally read once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="editor" ref={rootRef} />
}
