import type { ReactNode } from 'react'

export interface ConfigField {
  key: string
  label: string
  placeholder?: string
  type?: 'text' | 'password'
  /** Optional fields don't block a destination from being "configured". */
  optional?: boolean
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
  /**
   * Perform the publish/send for the given markdown.
   * Throw to signal failure — the UI surfaces the message.
   * May return a result message (e.g. a created URL) shown on success.
   */
  send: (markdown: string, ctx: DestinationContext) => Promise<string | void> | string | void
}
