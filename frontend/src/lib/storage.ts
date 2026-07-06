const DRAFT_KEY = 'inputpub.draft'
const configKey = (destId: string, field: string) => `inputpub.config.${destId}.${field}`
const enabledKey = (destId: string) => `inputpub.enabled.${destId}`
const IMAGE_HOST_DEFAULT_KEY = 'inputpub.imagehost.default'
const VAULT_INSTANCES_KEY = 'inputpub.vault.instances'
const VAULT_ACTIVE_KEY = 'inputpub.vault.active'
const VAULT_OPEN_FILE_KEY = 'inputpub.vault.openFile'

export function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(markdown: string): void {
  try {
    localStorage.setItem(DRAFT_KEY, markdown)
  } catch {
    /* storage unavailable — ignore */
  }
}

export function getConfig(destId: string, field: string): string | undefined {
  try {
    return localStorage.getItem(configKey(destId, field)) ?? undefined
  } catch {
    return undefined
  }
}

export function setConfig(destId: string, field: string, value: string): void {
  try {
    localStorage.setItem(configKey(destId, field), value)
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Whether a destination is enabled (shown in the menu). undefined = unset. */
export function getEnabled(destId: string): boolean | undefined {
  try {
    const v = localStorage.getItem(enabledKey(destId))
    return v == null ? undefined : v === '1'
  } catch {
    return undefined
  }
}

export function setEnabled(destId: string, on: boolean): void {
  try {
    localStorage.setItem(enabledKey(destId), on ? '1' : '0')
  } catch {
    /* storage unavailable — ignore */
  }
}

/** AI provider config (OpenAI-compatible: base URL + API key + model). Stored
 *  only in this browser; the provider request goes straight to the endpoint. */
export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const aiKey = (field: keyof AiConfig) => `inputpub.ai.${field}`

export function getAiConfig(): AiConfig {
  const read = (field: keyof AiConfig) => {
    try {
      return localStorage.getItem(aiKey(field)) ?? ''
    } catch {
      return ''
    }
  }
  return { baseUrl: read('baseUrl'), apiKey: read('apiKey'), model: read('model') }
}

export function setAiConfig(cfg: AiConfig): void {
  try {
    localStorage.setItem(aiKey('baseUrl'), cfg.baseUrl)
    localStorage.setItem(aiKey('apiKey'), cfg.apiKey)
    localStorage.setItem(aiKey('model'), cfg.model)
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Whether the AI provider has enough config to run (key + model). */
export function isAiConfigured(): boolean {
  const { apiKey, model } = getAiConfig()
  return !!apiKey.trim() && !!model.trim()
}

/** A user-editable AI suggestion: the `label` shown in the ✨ palette and the
 *  `prompt` (instruction) sent to the model when picked. */
export interface AiPrompt {
  id: string
  label: string
  prompt: string
}

const AI_PROMPTS_KEY = 'inputpub.ai.prompts'

/** Starter prompts, seeded on first use. A few simple one-shot actions; users
 *  can edit or delete any of them. Crepe's more elaborate tone/translate
 *  submenus are intentionally left out. */
export const DEFAULT_AI_PROMPTS: AiPrompt[] = [
  {
    id: 'improve',
    label: 'Improve writing',
    prompt: 'Improve the writing while preserving the original meaning.',
  },
  {
    id: 'grammar',
    label: 'Fix grammar & spelling',
    prompt: 'Fix any grammar and spelling errors without changing the meaning.',
  },
  {
    id: 'shorter',
    label: 'Make shorter',
    prompt: 'Make this shorter while preserving the key information.',
  },
  {
    id: 'longer',
    label: 'Make longer',
    prompt: 'Expand this with more detail and examples.',
  },
]

export function getAiPrompts(): AiPrompt[] {
  try {
    const raw = localStorage.getItem(AI_PROMPTS_KEY)
    if (raw == null) return DEFAULT_AI_PROMPTS // never configured — seed defaults
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_AI_PROMPTS
    // Keep only well-formed rows; an empty array is a valid "removed all" state.
    return parsed.filter(
      (p): p is AiPrompt =>
        !!p && typeof p.id === 'string' && typeof p.label === 'string' && typeof p.prompt === 'string',
    )
  } catch {
    return DEFAULT_AI_PROMPTS
  }
}

export function setAiPrompts(prompts: AiPrompt[]): void {
  try {
    localStorage.setItem(AI_PROMPTS_KEY, JSON.stringify(prompts))
  } catch {
    /* storage unavailable — ignore */
  }
}

/** The id of the image host chosen as default for uploads (unset = none). */
export function getImageHostDefault(): string | undefined {
  try {
    return localStorage.getItem(IMAGE_HOST_DEFAULT_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function setImageHostDefault(id: string): void {
  try {
    localStorage.setItem(IMAGE_HOST_DEFAULT_KEY, id)
  } catch {
    /* storage unavailable — ignore */
  }
}

/** One connected vault — its own config namespace is `vault.<id>.*` (see
 *  vault/index.ts's vaultNs), so the same provider (e.g. GitHub) can be
 *  connected more than once with independent settings. */
export interface VaultInstanceRecord {
  id: string
  providerId: string
}

export function getVaultInstances(): VaultInstanceRecord[] {
  try {
    const raw = localStorage.getItem(VAULT_INSTANCES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (v): v is VaultInstanceRecord =>
        !!v && typeof v.id === 'string' && typeof v.providerId === 'string',
    )
  } catch {
    return []
  }
}

export function setVaultInstances(instances: VaultInstanceRecord[]): void {
  try {
    localStorage.setItem(VAULT_INSTANCES_KEY, JSON.stringify(instances))
  } catch {
    /* storage unavailable — ignore */
  }
}

/** The id of the vault instance currently active (unset = no vault). */
export function getActiveVaultId(): string | undefined {
  try {
    return localStorage.getItem(VAULT_ACTIVE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function setActiveVaultId(id: string): void {
  try {
    localStorage.setItem(VAULT_ACTIVE_KEY, id)
  } catch {
    /* storage unavailable — ignore */
  }
}

export function clearActiveVaultId(): void {
  try {
    localStorage.removeItem(VAULT_ACTIVE_KEY)
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Path of the vault file left open, so reloading the page reopens it. */
export function getVaultOpenFile(): string | undefined {
  try {
    return localStorage.getItem(VAULT_OPEN_FILE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

export function setVaultOpenFile(path: string): void {
  try {
    localStorage.setItem(VAULT_OPEN_FILE_KEY, path)
  } catch {
    /* storage unavailable — ignore */
  }
}

export function clearVaultOpenFile(): void {
  try {
    localStorage.removeItem(VAULT_OPEN_FILE_KEY)
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Debounce a function by `wait` ms. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
}
