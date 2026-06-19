import type { Destination } from './types'
import { deriveTitle } from '../lib/title'

/** Hand the content to the user's mail client via a mailto: link. */
export const email: Destination = {
  id: 'email',
  name: 'Email',
  icon: '✉️',
  send(markdown) {
    const subject = deriveTitle(markdown) || 'input.pub'
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(markdown)}`
    window.location.href = url
    return '已唤起邮件客户端'
  },
}
