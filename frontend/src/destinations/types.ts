export interface ConfigField {
  key: string
  label: string
  placeholder?: string
  type?: 'text' | 'password'
}

export interface DestinationContext {
  getConfig: (key: string) => string | undefined
  setConfig: (key: string, value: string) => void
}

export interface Destination {
  /** Stable unique id, also used as the localStorage config namespace. */
  id: string
  /** Human-facing name shown on the button. */
  name: string
  /** Emoji icon — keep the UI minimal, no icon library. */
  icon: string
  /** Optional short hint shown as a tooltip / under the button. */
  hint?: string
  /** If present, these fields must be filled (and stored) before sending. */
  config?: ConfigField[]
  /**
   * Perform the publish/send for the given markdown.
   * Throw to signal failure — the UI surfaces the message.
   * May return a result message (e.g. a created URL) shown on success.
   */
  send: (markdown: string, ctx: DestinationContext) => Promise<string | void> | string | void
}
