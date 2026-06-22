import type { Destination } from './types'
import { ClaudeIcon } from './icons'

/** Open Claude in a new chat with the content carried in as the prompt. */
export const claude: Destination = {
  id: 'claude',
  name: 'Claude',
  icon: ClaudeIcon,
  send(markdown) {
    const url = `https://claude.ai/new?q=${encodeURIComponent(markdown)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    return 'Opened in Claude'
  },
}
