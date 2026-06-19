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
  ref?: Ref<EditorHandle>
}

export function Editor({ defaultValue, onChange, ref }: EditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)

  // Keep the latest onChange without forcing the editor to re-create.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useImperativeHandle(ref, () => ({
    getMarkdown: () => crepeRef.current?.getMarkdown() ?? '',
  }))

  useEffect(() => {
    if (!rootRef.current) return

    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: 'input here, publish anywhere…' },
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
