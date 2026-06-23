import type { Destination } from './types'
import { MailIcon } from './icons'
import { templateHint } from './templateHelp'

/** Hand the content to the user's mail client via a mailto: link.
 *  mailto bodies are plain text, so the default flattens Markdown to text. */
export const email: Destination = {
  id: 'email',
  name: 'Email',
  icon: MailIcon,
  config: [
    {
      key: 'subject',
      label: 'Subject template',
      default: '{{ title }}',
      optional: true,
      hint: templateHint,
    },
    {
      key: 'body',
      label: 'Body template',
      type: 'textarea',
      optional: true,
      default: '{{ body | plain }}',
      hint: templateHint,
    },
  ],
  send(_markdown, ctx) {
    const subject = ctx.slot('subject') || 'Input Pub'
    const body = ctx.slot('body')
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.location.href = url
    return 'Opened your mail app'
  },
}
