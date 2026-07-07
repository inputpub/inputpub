import type { ReactNode } from 'react'
import type { ConfigField } from '../destinations/types'

// A vault is a connected external store (a GitHub repo today; a local folder
// or Google Drive could follow) browsed as a file tree and edited in place.
// Mirrors the imagehosts registry, but for multi-file read/write instead of
// one-shot binary uploads.
//
// A VaultProvider is a *type* of store (e.g. "GitHub"); the user can connect
// several independent *instances* of the same type (e.g. two different
// repos). Each instance gets its own generated id and its own config
// namespace (see lib/vault.ts and storage.getVaultInstances) — nothing here
// is keyed by the provider's own id.

export type { ConfigField }

export interface VaultEntry {
  path: string
  type: 'file' | 'dir'
}

export interface VaultFile {
  content: string
  /** The provider's revision marker (e.g. a GitHub blob sha), passed back to
   *  `writeFile` so a stale overwrite can be detected. Revision tracking is
   *  the provider's own affair — nothing outside it should cache these. */
  sha: string
}

export interface VaultContext {
  /** The instance this context belongs to. Providers that need out-of-band
   *  per-instance storage (an IndexedDB directory handle, an OAuth token)
   *  should key it by this, so the same provider type can be connected more
   *  than once without the instances trampling each other. */
  id: string
  /** Read one of this instance's stored config values. */
  getConfig: (key: string) => string | undefined
  /** Store one of this instance's config values (e.g. a connected folder's
   *  display name) — for providers whose `connect` step isn't just filling
   *  in `config` fields. */
  setConfig: (key: string, value: string) => void
}

/** Thrown by `writeFile` when the given `sha` no longer matches the remote
 *  file (it changed since it was last read) — the caller should reload
 *  before retrying rather than overwriting. */
export class VaultConflictError extends Error {}

/** Files shown in a vault tree — the editor only handles text/Markdown. */
export const TEXT_EXT = /\.(md|markdown|mdx|txt)$/i

export interface VaultProvider {
  /** Stable id for this provider *type* (e.g. "github") — shared by every
   *  instance connected through it. */
  id: string
  name: string
  icon: ReactNode
  /** Plain-language one-liner shown in the "choose a vault type" picker —
   *  written for someone who doesn't know what a token or a picker API is. */
  blurb: string
  /** Fields to configure before this provider can be connected. Leave empty
   *  for providers that connect via `connect` instead (e.g. a native picker). */
  config: ConfigField[]
  /** Set when a write has a real cost (e.g. a GitHub save is a commit), so
   *  edits are batched into occasional checkpoint saves and the UI shows an
   *  Unsaved/Saving/Saved indicator. Leave unset for cheap writes (e.g. a
   *  local disk file), which save near-instantly with no indicator. */
  batchWrites?: {
    /** Idle delay (seconds) before a staged edit auto-saves. */
    defaultDelaySeconds: number
    /** Name of the config field letting the user override the delay —
     *  declare it in `config` too so it shows in the connect form. */
    delayConfigKey?: string
  }
  /** Custom connect step run when the user clicks Connect, before checking
   *  readiness — e.g. opening a native directory picker. Config fields (if
   *  any) are saved first. Throw to surface an error in the connect form. */
  connect?: (ctx: VaultContext) => Promise<void>
  /** Custom teardown run when the user disconnects this provider — e.g.
   *  forgetting a native handle so the app doesn't retain filesystem access. */
  disconnect?: (ctx: VaultContext) => Promise<void>
  /** Overrides the default "every required config field has a value" check —
   *  for providers whose readiness isn't just about filled-in fields. */
  isConfigured?: (ctx: VaultContext) => boolean
  /** Short status shown in the connect form, e.g. "Connected to: MyNotes". */
  describe?: (ctx: VaultContext) => string | undefined
  /** Short, instance-specific display name for the vault switcher (e.g. the
   *  repo "timqian/notes", or a folder's name) — falls back to the
   *  provider's own `name` when unset (e.g. before it's configured). */
  label?: (ctx: VaultContext) => string | undefined
  /** List every file in the vault (flat; directories are inferred from paths). */
  listTree: (ctx: VaultContext) => Promise<VaultEntry[]>
  readFile: (ctx: VaultContext, path: string) => Promise<VaultFile>
  /** Create (no `sha`) or update (with the current `sha`) a file. */
  writeFile: (ctx: VaultContext, path: string, content: string, sha?: string) => Promise<{ sha: string }>
  /** Delete a file. Providers needing a current revision to delete (e.g.
   *  GitHub's sha) look it up themselves — callers only know the path. */
  deleteFile: (ctx: VaultContext, path: string) => Promise<void>
}
