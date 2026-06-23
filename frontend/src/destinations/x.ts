import type { Destination } from './types'
import { XIcon } from './icons'
import { templateHint } from './templateHelp'

/** Open X's compose window with the content pre-filled — no auth needed.
 *  X is plain text only; the default template flattens Markdown to text. */
export const x: Destination = {
  id: 'x',
  name: 'X',
  icon: XIcon,
  hint: '280-character limit — trim if longer',
  config: [
    {
      key: 'text',
      label: 'Post template',
      type: 'textarea',
      optional: true,
      default: '{{ body | plain }}',
      hint: templateHint,
    },
  ],
  send(_markdown, ctx) {
    const text = ctx.slot('text')
    const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    return 'Opened the X compose window'
  },
}
