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
    // /intent/tweet, not the newer /intent/post, however dated the word looks.
    // X's app claims every x.com link, but only routes the paths it knows to a
    // native screen — and /intent/post isn't one of them, so on a phone it
    // opened the app only to dump the page into its in-app browser. /intent/tweet
    // is the path that has always mapped to the native composer, and it still
    // serves the same page on the web.
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    return 'Opened the X compose window'
  },
}
