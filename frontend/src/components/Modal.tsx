import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'

// Centered modal shell shared by every dialog: a dimmed overlay, a card, and
// dismissal on overlay click or Escape. Compose with the styled sub-pieces
// (ModalTitle / ModalNote / ModalActions / Button) so each dialog only writes
// its own body.

// dvh, not vh: on iOS `vh` counts the area behind the retracted URL bar, so an
// 85vh dialog could still run off the bottom of what's actually visible. The
// insets keep it clear of the notch and home indicator in standalone mode.
const overlayCls =
  'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]'
const dialogCls =
  'flex max-h-[85dvh] w-full max-w-[420px] flex-col gap-[0.8rem] rounded-xl border border-line bg-surface p-[1.2rem]'
const titleCls = 'm-0 text-[1.05rem]'
const noteCls = 'm-0 text-[0.78rem] text-muted'
const actionsCls = 'flex justify-end gap-2'
const btnBaseCls =
  'cursor-pointer rounded-md px-[0.9rem] py-[0.45rem] disabled:cursor-default disabled:opacity-50'
const btnVariantCls = {
  primary: 'border border-btn-bg bg-btn-bg text-btn-fg',
  ghost: 'border border-line bg-transparent text-inherit',
}

export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={overlayCls} onClick={onClose}>
      <div className={dialogCls} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function ModalTitle({ children }: { children: ReactNode }) {
  return <h2 className={titleCls}>{children}</h2>
}

export function ModalNote({ children }: { children: ReactNode }) {
  return <p className={noteCls}>{children}</p>
}

export function ModalActions({ children }: { children: ReactNode }) {
  return <div className={actionsCls}>{children}</div>
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  return (
    <button
      type="button"
      className={`${btnBaseCls} ${btnVariantCls[variant]}${className ? ` ${className}` : ''}`}
      {...props}
    />
  )
}
