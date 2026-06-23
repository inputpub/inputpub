import type { Destination } from './types'
import { HackerNewsIcon } from './icons'
import { templateHint } from './templateHelp'

/**
 * Hacker News has no text-post prefill, so copy the content and open the submit
 * page — the user adds a title and pastes the body. HN renders plain text, so
 * the default flattens Markdown. Off by default.
 */
export const hackernews: Destination = {
  id: 'hackernews',
  name: 'Hacker News',
  icon: HackerNewsIcon,
  defaultEnabled: false,
  clipboard: { url: 'https://news.ycombinator.com/submit' },
  config: [
    {
      key: 'content',
      label: 'Content template',
      type: 'textarea',
      optional: true,
      default: '{{ body | plain }}',
      hint: templateHint,
    },
  ],
}
