import type { Destination } from './types'

/** Open ChatGPT with the content carried in as the prompt. */
export const chatgpt: Destination = {
  id: 'chatgpt',
  name: 'ChatGPT',
  icon: '🤖',
  send(markdown) {
    const url = `https://chatgpt.com/?q=${encodeURIComponent(markdown)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    return '已在 ChatGPT 打开'
  },
}
