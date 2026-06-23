import type { Destination } from './types'
import { GeminiIcon } from './icons'
import { templateHint } from './templateHelp'

/**
 * Gemini has no URL prompt prefill, so copy the content to the clipboard and
 * open the app — the user just pastes.
 */
export const gemini: Destination = {
  id: 'gemini',
  name: 'Gemini',
  icon: GeminiIcon,
  defaultEnabled: false,
  clipboard: { url: 'https://gemini.google.com/app' },
  config: [
    {
      key: 'content',
      label: 'Content template',
      type: 'textarea',
      optional: true,
      default: '{{ body }}',
      hint: templateHint,
    },
  ],
}
