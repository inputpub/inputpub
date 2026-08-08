import { useEffect, type RefObject } from 'react'

/** How close to the left edge a touch has to start to count as reaching for a
 *  shut drawer. Narrow on purpose: everywhere else on that edge belongs to the
 *  page, and the editor is right underneath. */
const EDGE = 24
/** Movement before the gesture's axis is called. Below this the finger hasn't
 *  said anything yet; above it, the larger component wins and the other kind of
 *  gesture is handed back to the page for the rest of the touch. */
const AXIS_LOCK = 8
/** How much of the drawer has to be showing on release for it to stay. */
const COMMIT = 0.4
/** …unless the finger was still moving this fast (px/ms), in which case the
 *  direction of the flick decides and distance doesn't matter. */
const FLING = 0.4

const clamp = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

interface Options {
  /** Only true where the panel is actually a drawer — see SIDEBAR_DRAWER_QUERY. */
  enabled: boolean
  open: boolean
  /** The panel element, measured to turn finger travel into progress. */
  panelRef: RefObject<HTMLElement | null>
  /** A touch landed somewhere this gesture could start from. The panel is only
   *  mounted once it's first been opened, so this is the cue to put it in the
   *  DOM — by the time the axis is settled a few pixels later, it needs to be
   *  there to be measured. */
  onReach: () => void
  /** Progress for this frame, or null to hand the value back to CSS. */
  onProgress: (progress: number | null, dragging: boolean) => void
  /** Where the drawer ended up once the finger left. */
  onSettle: (open: boolean) => void
}

/**
 * Drag the vault drawer with a finger: from the left edge to pull it out, from
 * anywhere to push it back once it's open. Reports progress rather than moving
 * anything itself — index.css turns that one number into the panel's offset,
 * the page's shift and the scrim's opacity together.
 *
 * Known limitation: in iOS Safari the left edge is the system's back gesture,
 * which takes precedence and can't reliably be prevented. Installed to the Home
 * Screen there's no back gesture and this has the edge to itself.
 */
export function useDrawerSwipe({
  enabled,
  open,
  panelRef,
  onReach,
  onProgress,
  onSettle,
}: Options): void {
  useEffect(() => {
    if (!enabled) return

    let startX = 0
    let startY = 0
    let width = 0
    let from = 0
    let progress = 0
    // null = not tracking this touch; 'undecided' = still short of AXIS_LOCK.
    let axis: 'undecided' | 'horizontal' | null = null
    let lastX = 0
    let lastAt = 0
    let velocity = 0

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (e.touches.length !== 1 || !touch) return
      // Shut, the gesture has to begin at the edge; open, the drawer and its
      // scrim cover everything worth touching, so anywhere will do.
      if (!open && touch.clientX > EDGE) return
      from = progress = open ? 1 : 0
      startX = lastX = touch.clientX
      startY = touch.clientY
      lastAt = e.timeStamp
      velocity = 0
      width = 0
      axis = 'undecided'
      onReach()
    }

    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!axis || !touch) return
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (axis === 'undecided') {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return
        if (Math.abs(dy) >= Math.abs(dx)) {
          // Vertical: this touch belongs to the page. Let go of it completely
          // rather than staying half-attached and grabbing it back later.
          axis = null
          return
        }
        // Measured here, not at touchstart: onReach may have only just put the
        // panel in the DOM. If it still isn't there, drop the gesture — better
        // than dividing by zero and snapping the drawer to an end state.
        width = panelRef.current?.offsetWidth ?? 0
        if (!width) {
          axis = null
          return
        }
        axis = 'horizontal'
      }

      // Ours now — don't let the page scroll out from under the drag.
      if (e.cancelable) e.preventDefault()
      const dt = e.timeStamp - lastAt
      if (dt > 0) velocity = (touch.clientX - lastX) / dt
      lastX = touch.clientX
      lastAt = e.timeStamp
      progress = clamp(from + dx / width)
      onProgress(progress, true)
    }

    const onEnd = () => {
      if (axis !== 'horizontal') {
        axis = null
        return
      }
      axis = null
      const settled = Math.abs(velocity) > FLING ? velocity > 0 : progress > COMMIT
      // Hold the finished value inline until React has caught up with the new
      // state — releasing it here would snap back to the old one for a frame.
      progress = settled ? 1 : 0
      onProgress(progress, false)
      onSettle(settled)
    }

    // touchmove is non-passive so it can preventDefault the page's scroll.
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [enabled, open, panelRef, onReach, onProgress, onSettle])
}
