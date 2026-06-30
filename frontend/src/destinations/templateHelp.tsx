import type { ReactNode } from 'react'

/** Compact help shown under each template field: available variables + filters.
 *  Shared across destinations so the slot fields stay consistent. */
export const templateHint: ReactNode = (
  <>
    <code>{'{{title}}'}</code> <code>{'{{date}}'}</code> <code>{'{{datetime}}'}</code>{' '}
    <code>{'{{body}}'}</code> <code>{'{{filename}}'}</code> · filters <code>| plain</code>{' '}
    <code>| mp-html</code> <code>| no-title</code> <code>| no-images</code> <code>| quote</code> ·
    empty uses the default ·{' '}
    <a href="/template" target="_blank" rel="noreferrer">
      docs
    </a>
  </>
)
