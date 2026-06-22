import type { Destination } from './types'
import { GeminiIcon } from './icons'

/**
 * Gemini has no URL prompt prefill, so the app copies the content to the
 * clipboard and opens the app — the user just pastes.
 */
export const gemini: Destination = {
  id: 'gemini',
  name: 'Gemini',
  icon: GeminiIcon,
  clipboard: { url: 'https://gemini.google.com/app' },
}
