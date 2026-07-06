import type { ReactNode } from 'react'

// Dropdown panel shared by the tools and publish menus. The trigger button and
// its open state live with each caller (they differ); this owns the panel and
// item styling. Dismissal is handled by the caller via useDismiss.

const menuCls =
  'absolute z-20 top-[calc(100%+0.5rem)] flex min-w-[184px] flex-col gap-[0.15rem] rounded-lg border border-line bg-surface p-[0.3rem] shadow-[0_4px_20px_rgba(0,0,0,0.12)]'
const itemCls =
  'flex cursor-pointer items-center gap-[0.6rem] rounded-lg px-[0.7rem] py-[0.55rem] text-left hover:bg-hover'
const itemIconCls =
  'inline-flex w-[1.4rem] items-center justify-center text-[1.1rem] leading-none [&_svg]:block [&_svg]:size-[1em]'

/** `align` anchors the panel to the trigger's right (default) or left edge. */
export function Menu({
  align = 'right',
  children,
}: {
  align?: 'left' | 'right'
  children: ReactNode
}) {
  return (
    <div className={`${menuCls} ${align === 'left' ? 'left-0 right-auto' : 'right-0'}`} role="menu">
      {children}
    </div>
  )
}

export function MenuItem({
  icon,
  title,
  href,
  onClick,
  trailing,
  children,
}: {
  icon: ReactNode
  title?: string
  /** When set, the item is a link opened in a new tab. */
  href?: string
  onClick?: () => void
  /** Optional element pinned to the item's right edge (e.g. a submenu chevron). */
  trailing?: ReactNode
  children: ReactNode
}) {
  const inner = (
    <>
      <span className={itemIconCls}>{icon}</span>
      <span className="whitespace-nowrap">{children}</span>
      {trailing && <span className="ml-auto inline-flex pl-[0.6rem] opacity-45">{trailing}</span>}
    </>
  )
  if (href) {
    return (
      <a
        role="menuitem"
        className={itemCls}
        title={title}
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={onClick}
      >
        {inner}
      </a>
    )
  }
  return (
    <button type="button" role="menuitem" className={itemCls} title={title} onClick={onClick}>
      {inner}
    </button>
  )
}

export function MenuDivider() {
  return <div className="mx-[0.2rem] my-[0.3rem] h-px bg-line" />
}
