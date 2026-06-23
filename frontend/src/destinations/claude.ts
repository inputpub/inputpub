import type { Destination } from './types'
import { ClaudeIcon } from './icons'
import { templateHint } from './templateHelp'

/** Open Claude in a new chat with the content carried in as the prompt. */
export const claude: Destination = {
  id: 'claude',
  name: 'Claude',
  icon: ClaudeIcon,
  defaultEnabled: false,
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
    const url = `https://claude.ai/new?q=${encodeURIComponent(ctx.slot('text').trim())}`
    window.open(url, '_blank', 'noopener,noreferrer')
    return 'Opened in Claude'
  },
}
