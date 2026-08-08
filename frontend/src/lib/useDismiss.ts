import { useEffect, type RefObject } from 'react'

/** Close a transient surface (a dropdown menu) on an outside click or Escape.
 *  Only listens while `active`; pass a stable `onDismiss` (e.g. useCallback). */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onDismiss()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss()
    // pointerdown, not mousedown: iOS only synthesizes mouse events for targets
    // it considers clickable, so tapping empty page area left menus stuck open.
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, onDismiss, active])
}
