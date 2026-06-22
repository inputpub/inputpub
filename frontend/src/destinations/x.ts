import type { Destination } from './types'
import { markdownToText } from '../lib/markdown'
import { XIcon } from './icons'

/** Open X's compose window with the content pre-filled — no auth needed.
 *  X is plain text only, so flatten Markdown to readable text first. */
export const x: Destination = {
  id: 'x',
  name: 'X',
  icon: XIcon,
  hint: '280-character limit — trim if longer',
  send(markdown) {
    const text = markdownToText(markdown)
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    return 'Opened the X compose window'
  },
}
