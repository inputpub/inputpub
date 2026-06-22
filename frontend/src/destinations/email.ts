import type { Destination } from './types'
import { deriveTitle } from '../lib/title'
import { markdownToText } from '../lib/markdown'

/** Hand the content to the user's mail client via a mailto: link.
 *  mailto bodies are plain text, so flatten Markdown to readable text. */
export const email: Destination = {
  id: 'email',
  name: 'Email',
  icon: '✉️',
  send(markdown) {
    const subject = deriveTitle(markdown) || 'Input Pub'
    const body = markdownToText(markdown)
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.location.href = url
    return '已唤起邮件客户端'
  },
}
