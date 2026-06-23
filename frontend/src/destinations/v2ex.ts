import type { Destination } from './types'
import { V2exIcon } from './icons'
import { templateHint } from './templateHelp'

/**
 * V2EX has no public topic-creation API or compose prefill, so the app copies
 * the content to the clipboard and opens the "new topic" page — the user picks
 * a node and pastes. Off by default (niche destination).
 */
export const v2ex: Destination = {
  id: 'v2ex',
  name: 'V2EX',
  icon: V2exIcon,
  defaultEnabled: false,
  clipboard: { url: 'https://www.v2ex.com/write' },
  config: [
    {
      key: 'content',
      label: 'Content template',
      type: 'textarea',
      optional: true,
      default: '{{ body }}',
      hint: templateHint,
    },
  ],
}
