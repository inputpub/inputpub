export type ToastStatus = { kind: 'ok' | 'error'; text: string; big?: boolean }

// Transient status pill. The `big` variant (centered, larger) is used for
// clipboard hand-offs so the user can't miss the "copied — paste there" note.
export function Toast({ status }: { status: ToastStatus }) {
  return (
    <div
      className={`fixed left-1/2 z-[60] -translate-x-1/2 rounded-full ${
        status.kind === 'ok' ? 'bg-btn-bg text-btn-fg' : 'bg-[#e5484d] text-white'
      } ${
        status.big
          ? 'top-1/2 max-w-[min(90vw,30rem)] -translate-y-1/2 px-[1.4rem] py-4 text-center text-base leading-[1.45] shadow-[0_8px_32px_rgba(0,0,0,0.3)]'
          : // Clear of the home indicator when installed to the Home Screen.
            'bottom-[calc(1.5rem+env(safe-area-inset-bottom))] px-4 py-[0.55rem] text-[0.85rem] shadow-[0_4px_16px_rgba(0,0,0,0.25)]'
      }`}
      role="status"
    >
      {status.text}
    </div>
  )
}
