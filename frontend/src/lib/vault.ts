import {
  clearActiveVaultId,
  clearVaultOpenFile,
  getActiveVaultId,
  getConfig,
  getVaultInstances,
  getVaultOpenFile,
  setActiveVaultId,
  setConfig,
  setVaultInstances,
  setVaultOpenFile,
} from './storage'
import {
  vaultProviders,
  vaultNs,
  VaultConflictError,
  type VaultProvider,
  type VaultEntry,
  type VaultContext,
} from '../vault'

// Drives the connected vault(s) (multi-file stores, e.g. GitHub repos or
// local folders). A provider is a *type* of store; the user can connect
// several independent *instances* of the same type, each with its own
// generated id and its own `vault.<instanceId>` config namespace — see
// vault/types.ts for the provider/instance distinction. Mirrors
// lib/imageHost.ts's dispatch layer, plus the state needed to track which
// file is open so saves know its current revision (`sha`).

export interface VaultInstance {
  id: string
  provider: VaultProvider
}

/** Generates a fresh instance id for a new connection of the given provider
 *  type. Not persisted until the connection actually succeeds. */
export function generateVaultInstanceId(providerId: string): string {
  return `${providerId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Adds an instance to the saved list (a no-op if it's already there) —
 *  called once a new connection's config has been validated. */
export function registerVaultInstance(providerId: string, instanceId: string): void {
  const instances = getVaultInstances()
  if (!instances.some((i) => i.id === instanceId)) {
    setVaultInstances([...instances, { id: instanceId, providerId }])
  }
}

/** Every saved instance, resolved to its provider definition (silently
 *  dropping any whose provider type no longer exists). */
export function listVaultInstances(): VaultInstance[] {
  const instances: VaultInstance[] = []
  for (const rec of getVaultInstances()) {
    const provider = vaultProviders.find((p) => p.id === rec.providerId)
    if (provider) instances.push({ id: rec.id, provider })
  }
  return instances
}

export function activeVaultInstance(): VaultInstance | undefined {
  const id = getActiveVaultId()
  if (!id) return undefined
  return listVaultInstances().find((i) => i.id === id)
}

export function vaultCtxFor(instanceId: string): VaultContext {
  return {
    id: instanceId,
    getConfig: (key: string) => getConfig(vaultNs(instanceId), key),
    setConfig: (key: string, value: string) => setConfig(vaultNs(instanceId), key, value),
  }
}

/** An instance can be used once it's ready — by default, once every required
 *  config field has a value, or per the provider's own `isConfigured` check
 *  for providers that connect some other way (e.g. a native picker). */
export function isVaultInstanceConfigured(instanceId: string, provider: VaultProvider): boolean {
  if (provider.isConfigured) return provider.isConfigured(vaultCtxFor(instanceId))
  return provider.config.every((f) => f.optional || getConfig(vaultNs(instanceId), f.key)?.trim())
}

export function isVaultConnected(): boolean {
  return !!activeVaultInstance()
}

/** Whether the active vault should batch edits into occasional saves (e.g.
 *  GitHub, where every save is a commit) rather than save on every edit —
 *  a local folder write is just an instant disk write with no such cost. */
export function activeVaultBatchesWrites(): boolean {
  return !!activeVaultInstance()?.provider.batchWrites
}

/** Flush any staged edit without surfacing failures — used before changing
 *  what's active (switching files/vaults, disconnecting), where the failure
 *  is already shown via the save-state subscription and shouldn't block. */
async function flushQuietly(): Promise<void> {
  await flushPendingVaultSave().catch(() => {})
}

export async function connectVault(instanceId: string): Promise<void> {
  await flushQuietly()
  setActiveVaultId(instanceId)
}

/** Disconnects one instance: flushes any pending edit first (if it's the
 *  active one), runs the provider's teardown (if any), drops it from the
 *  saved list, and — if it was the active one — clears that too. */
export async function removeVaultInstance(instanceId: string): Promise<void> {
  if (getActiveVaultId() === instanceId) await flushQuietly()
  const instances = getVaultInstances()
  const rec = instances.find((i) => i.id === instanceId)
  const provider = rec && vaultProviders.find((p) => p.id === rec.providerId)
  if (provider?.disconnect) await provider.disconnect(vaultCtxFor(instanceId))
  setVaultInstances(instances.filter((i) => i.id !== instanceId))
  if (getActiveVaultId() === instanceId) {
    clearActiveVaultId()
    clearOpenFile()
  }
}

/** Disconnects whichever instance is currently active (a no-op if none is). */
export async function disconnectVault(): Promise<void> {
  const active = activeVaultInstance()
  if (active) await removeVaultInstance(active.id)
}

export async function loadVaultTree(): Promise<VaultEntry[]> {
  const active = activeVaultInstance()
  if (!active) throw new Error('No vault connected')
  return active.provider.listTree(vaultCtxFor(active.id))
}

// The currently open vault file, tracked here (not in React state) so
// `saveVaultFile` always has the right `sha` and can skip no-op writes.
let openPath: string | undefined
let openSha: string | undefined
let lastSavedContent: string | undefined
// The editor normalizes Markdown when it loads a document and emits one
// `markdownUpdated` for that round-trip — not a user edit. This makes the
// next `stageVaultEdit` adopt that emission as the clean baseline, so opening
// a file doesn't show "Unsaved changes" (and a later autosave doesn't commit
// a pure-reformatting diff).
let awaitingBaseline = false

export function currentVaultFile(): string | undefined {
  return openPath
}

export function clearOpenFile(): void {
  openPath = undefined
  openSha = undefined
  lastSavedContent = undefined
  awaitingBaseline = false
  clearPendingEdit()
  clearVaultOpenFile()
}

export async function openVaultFile(path: string): Promise<string> {
  await flushQuietly()
  const active = activeVaultInstance()
  if (!active) throw new Error('No vault connected')
  const file = await active.provider.readFile(vaultCtxFor(active.id), path)
  openPath = path
  openSha = file.sha
  lastSavedContent = file.content
  awaitingBaseline = true
  setVaultOpenFile(path)
  return file.content
}

/** Programmatically replacing the editor's content (e.g. "Load content")
 *  triggers the same normalized reload echo as opening a file — so mark the
 *  next emission as the baseline rather than a user edit. */
export function expectReloadEcho(): void {
  awaitingBaseline = true
}

// --- Staged edits: for providers that batch writes (see batchWrites above),
// edits aren't saved immediately — they're staged here and flushed on a
// checkpoint (switching files/vaults, losing focus, an idle timeout) so a
// long editing session doesn't produce a commit per keystroke pause.

export type VaultSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
let saveState: VaultSaveState = 'idle'
let saveError: string | undefined
const saveStateListeners = new Set<(state: VaultSaveState) => void>()

function setSaveState(state: VaultSaveState, error?: string) {
  saveState = state
  saveError = error
  saveStateListeners.forEach((cb) => cb(state))
}

export function getVaultSaveState(): VaultSaveState {
  return saveState
}

export function getVaultSaveError(): string | undefined {
  return saveError
}

/** Subscribes to save-state changes (for the UI's Saving…/Saved indicator).
 *  Returns an unsubscribe function. */
export function onVaultSaveStateChange(cb: (state: VaultSaveState) => void): () => void {
  saveStateListeners.add(cb)
  return () => saveStateListeners.delete(cb)
}

/** Resets the indicator to idle without touching any pending edit — for a
 *  freshly opened/created file that has nothing stale (e.g. a lingering
 *  error from the previous file) worth showing. */
export function resetVaultSaveState(): void {
  setSaveState('idle')
}

let pendingContent: string | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = undefined
}

function clearPendingEdit() {
  pendingContent = undefined
  clearIdleTimer()
  setSaveState('idle')
}

/** How long to wait after the last edit before auto-saving: per the
 *  provider's `batchWrites` contract (with the user's per-instance override,
 *  if the provider declares one), or a short fixed delay for providers that
 *  don't batch, just enough to coalesce keystrokes. */
function pendingSaveDelayMs(): number {
  const active = activeVaultInstance()
  const batch = active?.provider.batchWrites
  if (!active || !batch) return 800
  const raw = batch.delayConfigKey ? getConfig(vaultNs(active.id), batch.delayConfigKey) : undefined
  const seconds = raw ? parseInt(raw, 10) : NaN
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : batch.defaultDelaySeconds) * 1000
}

/** Stages an edit: doesn't save immediately, just marks the file dirty and
 *  (re)starts the auto-save timer. Call `flushPendingVaultSave` to save
 *  immediately (e.g. on a checkpoint). */
export function stageVaultEdit(content: string): void {
  // The editor's first emission after a (re)load is its normalized round-trip
  // of the loaded content, not a user edit — adopt it as the clean baseline
  // and stay idle.
  if (awaitingBaseline) {
    awaitingBaseline = false
    lastSavedContent = content
    clearPendingEdit()
    return
  }
  // Edited back to exactly the saved text — nothing to commit.
  if (content === lastSavedContent) {
    clearPendingEdit()
    return
  }
  pendingContent = content
  setSaveState('dirty')
  clearIdleTimer()
  idleTimer = setTimeout(() => void flushPendingVaultSave(), pendingSaveDelayMs())
}

/** Saves whatever edit is staged, if any — called on checkpoints (switching
 *  files/vaults, losing focus, disconnecting) and by the auto-save timer. */
export async function flushPendingVaultSave(): Promise<void> {
  clearIdleTimer()
  if (pendingContent === undefined) return
  const content = pendingContent
  pendingContent = undefined
  setSaveState('saving')
  try {
    await saveVaultFile(content)
    setSaveState('saved')
  } catch (err) {
    setSaveState('error', err instanceof Error ? err.message : String(err))
    throw err
  }
}

/** Reopens the file remembered from a previous session, if any. */
export async function reopenLastVaultFile(): Promise<{ path: string; content: string } | undefined> {
  const path = getVaultOpenFile()
  if (!path || !isVaultConnected()) return undefined
  try {
    const content = await openVaultFile(path)
    return { path, content }
  } catch {
    clearOpenFile()
    return undefined
  }
}

export async function saveVaultFile(content: string): Promise<void> {
  const active = activeVaultInstance()
  if (!active || !openPath) return
  if (content === lastSavedContent) return
  try {
    const { sha } = await active.provider.writeFile(
      vaultCtxFor(active.id),
      openPath,
      content,
      openSha,
    )
    openSha = sha
    lastSavedContent = content
  } catch (err) {
    if (err instanceof VaultConflictError) {
      // The file changed remotely — reload it so the next save has a fresh
      // sha, at the cost of losing this particular edit.
      const file = await active.provider.readFile(vaultCtxFor(active.id), openPath)
      openSha = file.sha
      lastSavedContent = file.content
    }
    throw err
  }
}

/** Creates an empty file and marks it as the open file (no read-back needed —
 *  the caller already knows the content is `''`). */
export async function createVaultFile(path: string): Promise<void> {
  await flushQuietly()
  const active = activeVaultInstance()
  if (!active) throw new Error('No vault connected')
  const { sha } = await active.provider.writeFile(vaultCtxFor(active.id), path, '')
  openPath = path
  openSha = sha
  lastSavedContent = ''
  awaitingBaseline = true
  setVaultOpenFile(path)
}

export async function deleteVaultFile(path: string): Promise<void> {
  const active = activeVaultInstance()
  if (!active) throw new Error('No vault connected')
  await active.provider.deleteFile(vaultCtxFor(active.id), path)
  if (openPath === path) clearOpenFile()
}
