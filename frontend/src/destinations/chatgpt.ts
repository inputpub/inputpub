import type { Destination } from './types'
import { ChatGPTIcon } from './icons'
import { templateHint } from './templateHelp'

/** Open ChatGPT with the content carried in as the prompt. */
export const chatgpt: Destination = {
  id: 'chatgpt',
  name: 'ChatGPT',
  icon: ChatGPTIcon,
  config: [
    {
      key: 'text',
      label: 'Prompt template',
      type: 'textarea',
      optional: true,
      default: '{{ body }}',
      hint: templateHint,
    },
  ],
  send(_markdown, ctx) {
    const url = `https://chatgpt.com/?q=${encodeURIComponent(ctx.slot('text').trim())}`
    window.open(url, '_blank', 'noopener,noreferrer')
    return 'Opened in ChatGPT'
  },
}
