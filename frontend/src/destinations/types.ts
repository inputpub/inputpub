import type { ReactNode } from 'react'

export interface ConfigField {
  key: string
  label: string
  placeholder?: string
  type?: 'text' | 'password'
  /** Optional fields don't block a destination from being "configured". */
  optional?: boolean
  /** Small helper text shown under the input (may contain a link). */
  hint?: ReactNode
  /** If set, the value is stored under a global key shared across destinations
   *  (e.g. one GitHub token for both the repo and gist targets). */
  shared?: string
}

export interface DestinationContext {
  getConfig: (key: string) => string | undefined
  setConfig: (key: string, value: string) => void
  /** Values collected at publish time via the destination's `prompt` fields. */
  input: Record<string, string>
}

export interface Destination {
  /** Stable unique id, also used as the localStorage config namespace. */
  id: string
  /** Human-facing name shown on the button. */
  name: string
  /** Emoji or inline SVG shown next to the name. */
  icon: ReactNode
  /** Optional short hint shown as a tooltip / under the button. */
  hint?: string
  /** If present, these fields must be filled (and stored) before sending. */
  config?: ConfigField[]
  /** If present, these values are collected at publish time and passed via ctx.input. */
  prompt?: ConfigField[]
  /** Whether the destination is shown in the menu by default (default: true). */
  defaultEnabled?: boolean
  /**
   * Copy-and-paste destinations (no API / no URL prefill). When set, publishing
   * copies the markdown to the clipboard, shows a prominent toast, then
   * navigates to this URL after a short delay so the user can read the toast
   * first and paste once they arrive. Such destinations don't need `send`.
   */
  clipboard?: { url: string }
  /**
   * Perform the publish/send for the given markdown.
   * Throw to signal failure — the UI surfaces the message.
   * May return a result message (e.g. a created URL) shown on success.
   * Optional for `clipboard` destinations, which are handled by the app.
   */
  send?: (markdown: string, ctx: DestinationContext) => Promise<string | void> | string | void
}
