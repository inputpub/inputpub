import type { Destination } from './types'
import { ChatGPTIcon } from './icons'

/** Open ChatGPT with the content carried in as the prompt. */
export const chatgpt: Destination = {
  id: 'chatgpt',
  name: 'ChatGPT',
  icon: ChatGPTIcon,
  send(markdown) {
    const url = `https://chatgpt.com/?q=${encodeURIComponent(markdown)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    return 'Opened in ChatGPT'
  },
}
