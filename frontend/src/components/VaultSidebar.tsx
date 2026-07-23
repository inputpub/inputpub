import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { vaultProviders, vaultNs, type VaultEntry, type VaultProvider } from '../vault'
import { getConfig, setConfig } from '../lib/storage'
import {
  activeVaultInstance,
  connectVault,
  createVaultFile,
  deleteVaultDir,
  deleteVaultFile,
  disconnectVault,
  generateVaultInstanceId,
  isVaultConnected,
  isVaultInstanceConfigured,
  listVaultInstances,
  loadVaultTree,
  registerVaultInstance,
  vaultCtxFor,
  type VaultInstance,
} from '../lib/vault'
import { CheckIcon, DocumentIcon, FolderIcon, GearIcon, PlusIcon, TrashIcon } from '../destinations/icons'
import { Field } from './Field'
import { Menu, MenuDivider, MenuItem } from './Menu'
import { useDismiss } from '../lib/useDismiss'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children: TreeNode[]
}

/** Turns the flat file list into a nested tree, synthesizing directory nodes
 *  from path segments (a vault provider only needs to report files). */
function buildTree(entries: VaultEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'dir', children: [] }
  const byPath = new Map<string, TreeNode>([['', root]])

  for (const entry of entries) {
    const parts = entry.path.split('/')
    let parentPath = ''
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('/')
      if (byPath.has(path)) {
        parentPath = path
        continue
      }
      const isLeaf = i === parts.length - 1
      const node: TreeNode = {
        name: parts[i],
        path,
        type: isLeaf ? entry.type : 'dir',
        children: [],
      }
      byPath.set(path, node)
      byPath.get(parentPath)!.children.push(node)
      parentPath = path
    }
  }

  const sortNode = (node: TreeNode) => {
    node.children.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1,
    )
    node.children.forEach(sortNode)
  }
  sortNode(root)
  return root.children
}

const rowCls =
  'group flex w-full cursor-pointer items-center gap-[0.4rem] rounded-md px-[0.4rem] py-[0.3rem] text-left text-[0.84rem] hover:bg-hover'
const iconCls =
  'inline-flex w-[1.1rem] shrink-0 items-center justify-center text-[0.95rem] [&_svg]:block [&_svg]:size-[1em]'

/** An instance's short display name — its provider's own identifying config
 *  (e.g. a repo or folder name) when available, else the provider's name. */
function instanceLabel(instance: VaultInstance): string {
  return instance.provider.label?.(vaultCtxFor(instance.id)) ?? instance.provider.name
}

/** The create-a-file interaction, threaded down the tree so a folder's + can
 *  target itself. `parent` is the folder path currently being created in
 *  ('' = tree root, null = not creating). */
interface CreateState {
  parent: string | null
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  onRequest: (parentPath: string) => void
}

/** The inline "name a new file" input — shown at the tree root, or nested in a
 *  folder once its + is clicked (in which case only the filename is typed and
 *  the folder path is prepended on submit). */
function NewFileInput({
  value,
  placeholder,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <input
      autoFocus
      className="mb-[0.3rem] w-full rounded-md border border-line bg-bg px-[0.5rem] py-[0.3rem] text-[0.82rem] text-inherit focus:border-accent focus:outline-none"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit()
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => {
        if (!value.trim()) onCancel()
      }}
    />
  )
}

function Row({
  node,
  depth,
  currentPath,
  create,
  onOpen,
  onDelete,
}: {
  node: TreeNode
  depth: number
  currentPath: string | undefined
  create: CreateState
  onOpen: (path: string) => void
  onDelete: (node: TreeNode) => void
}) {
  // Collapsed by default to keep the tree tidy; a folder starts open only when
  // it's on the path to the file currently loaded in the editor, so the active
  // file stays visible after a reload.
  const [open, setOpen] = useState(
    () => !!currentPath && currentPath.startsWith(`${node.path}/`),
  )
  // A folder's own chevron+icon already push its glyph ~1.5rem in, so a child
  // needs more than that per level or its icon lands in the same column as its
  // parent's, making folders and files hard to tell apart at a glance.
  const indent = { paddingLeft: `${0.4 + depth * 1.6}rem` }

  if (node.type === 'dir') {
    return (
      <div>
        <div className={rowCls} style={indent} onClick={() => setOpen((o) => !o)}>
          <svg
            className={`size-[0.8em] shrink-0 opacity-45 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          <span className={iconCls}>{FolderIcon}</span>
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <button
            type="button"
            className="ml-auto hidden shrink-0 rounded p-[0.15rem] text-muted opacity-70 hover:bg-line hover:text-text hover:opacity-100 group-hover:inline-flex [&_svg]:block [&_svg]:size-[0.85em]"
            title="New file in this folder"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(true)
              create.onRequest(node.path)
            }}
          >
            {PlusIcon}
          </button>
          <button
            type="button"
            className="hidden shrink-0 rounded p-[0.15rem] text-muted opacity-70 hover:bg-line hover:text-text hover:opacity-100 group-hover:inline-flex [&_svg]:block [&_svg]:size-[0.85em]"
            title="Delete folder"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(node)
            }}
          >
            {TrashIcon}
          </button>
        </div>
        {open && (
          <div>
            {create.parent === node.path && (
              <div style={{ paddingLeft: `${0.4 + (depth + 1) * 1.6}rem` }}>
                <NewFileInput
                  value={create.value}
                  placeholder="new-file.md"
                  onChange={create.onChange}
                  onSubmit={create.onSubmit}
                  onCancel={create.onCancel}
                />
              </div>
            )}
            {node.children.map((child) => (
              <Row
                key={child.path}
                node={child}
                depth={depth + 1}
                currentPath={currentPath}
                create={create}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`${rowCls} ${currentPath === node.path ? 'bg-hover' : ''}`}
      style={indent}
      onClick={() => onOpen(node.path)}
    >
      <span className={iconCls}>{DocumentIcon}</span>
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      <button
        type="button"
        className="ml-auto hidden shrink-0 rounded p-[0.15rem] text-muted opacity-70 hover:bg-line hover:text-text hover:opacity-100 group-hover:inline-flex [&_svg]:block [&_svg]:size-[0.85em]"
        title="Delete file"
        onClick={(e) => {
          e.stopPropagation()
          onDelete(node)
        }}
      >
        {TrashIcon}
      </button>
    </div>
  )
}

/** First-time / no-vault-yet screen: a plain-language choice between vault
 *  types, so someone who isn't a programmer isn't dropped straight into a
 *  GitHub-token form before they even know a local folder is an option. */
function TypePicker({ onSelect }: { onSelect: (providerId: string) => void }) {
  return (
    <div className="flex flex-col gap-[0.6rem] p-[0.7rem]">
      <p className="m-0 text-[0.78rem] text-muted">Choose where to keep your files.</p>
      {vaultProviders.map((p) => (
        <button
          key={p.id}
          type="button"
          className="flex cursor-pointer items-start gap-[0.6rem] rounded-lg border border-line px-[0.7rem] py-[0.6rem] text-left hover:bg-hover"
          onClick={() => onSelect(p.id)}
        >
          <span className={`${iconCls} mt-[0.1rem]`}>{p.icon}</span>
          <span className="flex flex-col gap-[0.15rem]">
            <span className="text-[0.86rem] font-medium">{p.name}</span>
            <span className="text-[0.74rem] leading-snug text-muted">{p.blurb}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** The inline "connect a vault" form for one specific instance (new or
 *  existing). Fields are saved straight to its own `vault.<id>` namespace, so
 *  the same provider can be connected more than once with independent config. */
function ConfigureForm({
  target,
  onCancel,
  cancelLabel = 'Cancel',
  onConnected,
}: {
  target: VaultInstance
  /** Omit to hide the cancel/back button (nothing sensible to return to). */
  onCancel?: () => void
  cancelLabel?: string
  onConnected: () => void
}) {
  const { id, provider } = target
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const f of provider.config) v[f.key] = getConfig(vaultNs(id), f.key) ?? ''
    return v
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function connect() {
    if (busy) return
    for (const f of provider.config) setConfig(vaultNs(id), f.key, (values[f.key] ?? '').trim())
    if (provider.connect) {
      setBusy(true)
      try {
        await provider.connect(vaultCtxFor(id))
      } catch (err) {
        setBusy(false)
        // A cancelled native picker isn't an error worth surfacing.
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : String(err))
        return
      }
      setBusy(false)
    }
    if (!isVaultInstanceConfigured(id, provider)) {
      setError('Fill in all required fields.')
      return
    }
    setError(null)
    registerVaultInstance(provider.id, id)
    await connectVault(id)
    onConnected()
  }

  const description = provider.describe?.(vaultCtxFor(id))

  return (
    <div className="flex flex-col gap-[0.7rem] p-[0.7rem]">
      <div className="flex items-center gap-[0.5rem] text-[0.86rem] font-medium">
        <span className={iconCls}>{provider.icon}</span>
        <span>{provider.name}</span>
      </div>
      <p className="m-0 text-[0.78rem] leading-snug text-muted">{provider.connectNote}</p>
      {provider.config.map((f) => (
        <Field
          key={f.key}
          field={f}
          value={values[f.key]}
          onChange={(value) => setValues((v) => ({ ...v, [f.key]: value }))}
        />
      ))}
      {description && <p className="m-0 text-[0.78rem] text-muted">{description}</p>}
      {error && <p className="m-0 text-[0.78rem] text-[#e5484d]">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            className="cursor-pointer rounded-md border border-line bg-transparent px-[0.7rem] py-[0.35rem] text-[0.82rem] text-inherit"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        )}
        <button
          type="button"
          className="cursor-pointer rounded-md border border-btn-bg bg-btn-bg px-[0.7rem] py-[0.35rem] text-[0.82rem] text-btn-fg disabled:cursor-default disabled:opacity-60"
          disabled={busy}
          onClick={() => void connect()}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  )
}

/** A fresh (not-yet-saved) instance for connecting a new vault of this type. */
function pendingInstance(provider: VaultProvider): VaultInstance {
  return { id: generateVaultInstanceId(provider.id), provider }
}

/** Falls back to a pending instance of the sole provider when there's only
 *  one type to choose from — otherwise null shows the type picker. */
function defaultConfigTarget(): VaultInstance | null {
  if (vaultProviders.length > 1) return null
  return vaultProviders[0] ? pendingInstance(vaultProviders[0]) : null
}

export function VaultSidebar({
  currentPath,
  onOpen,
  onCreated,
  onDeleted,
  onVaultChanged,
  onError,
}: {
  currentPath: string | undefined
  onOpen: (path: string) => void
  onCreated: (path: string) => void
  onDeleted: (path: string) => void
  /** Called whenever the active vault binding changes (connected, switched,
   *  reconfigured, or disconnected) — any previously open file may no longer
   *  belong to it, so the caller should drop back to the local draft. */
  onVaultChanged: () => void
  onError: (message: string) => void
}) {
  const [view, setView] = useState<'browse' | 'configure'>(() =>
    isVaultConnected() ? 'browse' : 'configure',
  )
  // Mirror of the active instance id, so the tree-reload effect below re-runs
  // when the active vault changes — not only on a view transition.
  const [activeId, setActiveId] = useState<string | undefined>(() => activeVaultInstance()?.id)
  // Which instance the configure form targets — a saved one (reconfiguring,
  // or switching to an unconfigured provider) or a fresh pending one (adding
  // a new vault). null = show the "choose a vault type" picker.
  const [configTarget, setConfigTarget] = useState<VaultInstance | null>(
    () => activeVaultInstance() ?? defaultConfigTarget(),
  )
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [entries, setEntries] = useState<VaultEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Which folder a new file is being named in: null = not creating, '' = tree
  // root (the header + button), or a folder path (that folder's hover +).
  const [createParent, setCreateParent] = useState<string | null>(null)
  const [newPath, setNewPath] = useState('')
  const [busy, setBusy] = useState(false)
  // Inline feedback for create/delete: a transient status line at the top of
  // the tree — in-progress while it runs (a GitHub write is a commit, so it
  // isn't instant), then a done state briefly after, since the affected row may
  // vanish (delete) or scroll out (create).
  const [deleting, setDeleting] = useState(false)
  const [opMsg, setOpMsg] = useState<{ text: string; done: boolean } | null>(null)
  const opMsgTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const switcherRef = useRef<HTMLDivElement>(null)
  const closeSwitcher = useCallback(() => setSwitcherOpen(false), [])
  useDismiss(switcherRef, closeSwitcher, switcherOpen)

  const flashDone = (text: string) => {
    setOpMsg({ text, done: true })
    if (opMsgTimer.current) clearTimeout(opMsgTimer.current)
    opMsgTimer.current = setTimeout(() => setOpMsg(null), 2500)
  }
  useEffect(() => () => clearTimeout(opMsgTimer.current), [])

  const refresh = () => {
    loadVaultTree()
      .then((data) => {
        setEntries(data)
        setLoadError(null)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        setLoadError(message)
        onError(message)
      })
  }

  useEffect(() => {
    if (view === 'browse' && activeId) refresh()
    // Reload when entering the browse view or when the active vault changes;
    // create/delete update the list directly instead (see submitCreate/
    // handleDelete).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeId])

  const tree = useMemo(() => (entries ? buildTree(entries) : []), [entries])

  const startCreate = (parent: string) => {
    setCreateParent(parent)
    setNewPath('')
  }
  const cancelCreate = () => {
    setCreateParent(null)
    setNewPath('')
  }

  async function submitCreate() {
    const name = newPath.trim()
    if (!name || busy || createParent === null) return
    // createParent === '' creates at the root (name may itself be a subpath);
    // otherwise the file lands inside the folder whose + was clicked.
    let path = createParent ? `${createParent}/${name}` : name
    if (!/\.md$/i.test(path)) path += '.md'
    const shown = path.split('/').pop() ?? path
    setBusy(true)
    setOpMsg({ text: `Creating ${shown}…`, done: false })
    try {
      await createVaultFile(path)
      setCreateParent(null)
      setNewPath('')
      // Update the list from what we already know, rather than re-fetching —
      // right after a write, some providers (e.g. GitHub) can briefly still
      // return the pre-write tree if the API is re-read immediately.
      setEntries((prev) => [...(prev ?? []), { path, type: 'file' }])
      onCreated(path)
      flashDone(`Created ${shown}`)
    } catch (err) {
      setOpMsg(null)
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(node: TreeNode) {
    if (deleting) return
    if (node.type === 'dir') {
      // A folder is synthesized from paths — deleting it deletes everything
      // beneath it (including files the tree doesn't show, see deleteVaultDir).
      if (
        !window.confirm(
          `Delete the folder “${node.name}” and all files inside it? This can’t be undone.`,
        )
      )
        return
      const prefix = `${node.path}/`
      setDeleting(true)
      setOpMsg({ text: `Deleting “${node.name}”…`, done: false })
      try {
        await deleteVaultDir(node.path)
        setEntries((prev) => prev?.filter((e) => e.path !== node.path && !e.path.startsWith(prefix)) ?? prev)
        if (currentPath && (currentPath === node.path || currentPath.startsWith(prefix))) {
          onDeleted(currentPath)
        }
        flashDone(`Deleted “${node.name}”`)
      } catch (err) {
        setOpMsg(null)
        onError(err instanceof Error ? err.message : String(err))
        // A folder delete can fail partway (several commits on GitHub) — resync
        // the tree to what actually remains.
        refresh()
      } finally {
        setDeleting(false)
      }
      return
    }
    if (!window.confirm(`Delete ${node.path}?`)) return
    setDeleting(true)
    setOpMsg({ text: `Deleting ${node.name}…`, done: false })
    try {
      await deleteVaultFile(node.path)
      setEntries((prev) => prev?.filter((e) => e.path !== node.path) ?? prev)
      onDeleted(node.path)
      flashDone(`Deleted ${node.name}`)
    } catch (err) {
      setOpMsg(null)
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  async function disconnect() {
    await disconnectVault()
    setEntries(null)
    setActiveId(undefined)
    setView('configure')
    // Nothing's connected anymore — back to the type picker (if there's an
    // actual choice to make) rather than lingering on the just-disconnected
    // instance's form.
    setConfigTarget(defaultConfigTarget())
    onVaultChanged()
  }

  // Picking an already-connected instance from the switcher: jump straight
  // into browsing it. (connectVault flushes any pending edit on the
  // previously active vault first; the tree-reload effect fires off the
  // activeId change.)
  async function selectInstance(instance: VaultInstance) {
    setSwitcherOpen(false)
    if (instance.id === activeVaultInstance()?.id) return
    await connectVault(instance.id)
    setEntries(null)
    setLoadError(null)
    setActiveId(instance.id)
    setView('browse')
    onVaultChanged()
  }

  // "Add a vault" from the switcher, or the very first connection: open a
  // blank connect form for a brand-new instance of this provider type.
  function startNewInstance(providerId: string) {
    setSwitcherOpen(false)
    const provider = vaultProviders.find((p) => p.id === providerId)
    if (!provider) return
    setConfigTarget(pendingInstance(provider))
    setView('configure')
  }

  function openConfigureForActive() {
    setConfigTarget(activeVaultInstance() ?? defaultConfigTarget())
    setView('configure')
  }

  function handleConnected() {
    setEntries(null)
    setLoadError(null)
    setActiveId(configTarget?.id)
    setView('browse')
    onVaultChanged()
  }

  const connected = isVaultConnected()
  const active = activeVaultInstance()
  const instances = listVaultInstances()
  const isConfiguringActive = !!configTarget && configTarget.id === active?.id
  // Cancel/back out of the configure form: to the active vault's file list if
  // there is one, else back to the type picker (when there's an actual choice).
  const configureCancel = connected
    ? () => setView('browse')
    : vaultProviders.length > 1
      ? () => setConfigTarget(null)
      : undefined

  const create: CreateState = {
    parent: createParent,
    value: newPath,
    onChange: setNewPath,
    onSubmit: () => void submitCreate(),
    onCancel: cancelCreate,
    onRequest: startCreate,
  }

  return (
    // Floats beside the sheet's left edge rather than hugging the viewport —
    // its position is derived from the same --sheet-max / --page-pad vars the
    // sheet and top bar use, so it tracks the sheet as the window resizes.
    // Below ~16rem of clearance (narrow windows) it clamps to --page-pad from
    // the viewport edge instead of overlapping the sheet.
    <div className="fixed top-16 bottom-4 z-30 flex w-60 flex-col border border-line bg-surface shadow left-[max(var(--page-pad),calc(50%-var(--sheet-max)/2-16rem))]">
      <div className="flex items-center gap-[0.3rem] border-b border-line px-[0.6rem] py-[0.55rem]">
        <div className="relative min-w-0 flex-1" ref={switcherRef}>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-1 rounded-md py-[0.1rem] text-left text-[0.82rem] font-medium text-muted hover:text-text"
            aria-haspopup="menu"
            aria-expanded={switcherOpen}
            onClick={() => setSwitcherOpen((o) => !o)}
          >
            <span className="truncate">{active ? instanceLabel(active) : 'Connect a vault'}</span>
            <svg
              className={`size-[0.7em] shrink-0 opacity-60 transition-transform duration-150 ${switcherOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {switcherOpen && (
            <Menu align="left">
              {instances.map((instance) => (
                <MenuItem
                  key={instance.id}
                  icon={instance.provider.icon}
                  trailing={instance.id === active?.id ? CheckIcon : undefined}
                  onClick={() => void selectInstance(instance)}
                >
                  {instanceLabel(instance)}
                </MenuItem>
              ))}
              {instances.length > 0 && <MenuDivider />}
              {vaultProviders.map((p) => (
                <MenuItem key={p.id} icon={PlusIcon} onClick={() => startNewInstance(p.id)}>
                  Add {p.name}
                </MenuItem>
              ))}
            </Menu>
          )}
        </div>
        {view === 'browse' && (
          <>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center justify-center rounded-md p-[0.3rem] text-muted hover:bg-hover hover:text-text [&_svg]:block [&_svg]:size-[0.95em]"
              title="New file"
              onClick={() => startCreate('')}
            >
              {PlusIcon}
            </button>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center justify-center rounded-md p-[0.3rem] text-muted hover:bg-hover hover:text-text [&_svg]:block [&_svg]:size-[0.95em]"
              title="Configure vault"
              onClick={openConfigureForActive}
            >
              {GearIcon}
            </button>
          </>
        )}
      </div>

      {view === 'configure' && !configTarget ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TypePicker onSelect={(providerId) => startNewInstance(providerId)} />
        </div>
      ) : view === 'configure' && configTarget ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConfigureForm
            key={configTarget.id}
            target={configTarget}
            onCancel={configureCancel}
            cancelLabel={connected ? 'Cancel' : 'Back'}
            onConnected={handleConnected}
          />
          {isConfiguringActive && connected && (
            <div className="mt-[0.5rem] border-t border-line px-[0.7rem] pb-[0.7rem] pt-[0.9rem]">
              <button
                type="button"
                className="w-full cursor-pointer rounded-md border border-[#e5484d]/40 bg-transparent px-[0.7rem] py-[0.35rem] text-[0.8rem] text-[#e5484d] hover:bg-[#e5484d]/10"
                onClick={() => void disconnect()}
              >
                Disconnect vault
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-[0.4rem]">
          {opMsg && (
            <div className="mb-[0.3rem] flex items-center gap-[0.4rem] px-[0.4rem] py-[0.3rem] text-[0.78rem] text-muted">
              {opMsg.done ? (
                <span className="inline-flex text-[#3fb950] [&_svg]:block [&_svg]:size-[0.9em]">
                  {CheckIcon}
                </span>
              ) : (
                <svg
                  className="size-[0.85em] shrink-0 animate-spin opacity-70"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              )}
              <span className="truncate">{opMsg.text}</span>
            </div>
          )}
          {createParent === '' && (
            <NewFileInput
              value={newPath}
              placeholder="notes/todo.md"
              onChange={setNewPath}
              onSubmit={() => void submitCreate()}
              onCancel={cancelCreate}
            />
          )}
          {entries === null ? (
            loadError ? (
              <div className="flex flex-col gap-[0.4rem] px-[0.4rem] py-[0.3rem] text-[0.8rem]">
                <p className="m-0 text-[#e5484d]">{loadError}</p>
                <button
                  type="button"
                  className="w-fit cursor-pointer rounded-md border border-line bg-transparent px-[0.6rem] py-[0.25rem] text-muted hover:text-text"
                  onClick={() => {
                    setLoadError(null)
                    refresh()
                  }}
                >
                  Retry
                </button>
              </div>
            ) : (
              <p className="px-[0.4rem] py-[0.3rem] text-[0.8rem] text-muted">Loading…</p>
            )
          ) : tree.length === 0 ? (
            <p className="px-[0.4rem] py-[0.3rem] text-[0.8rem] text-muted">No files yet.</p>
          ) : (
            tree.map((node) => (
              <Row
                key={node.path}
                node={node}
                depth={0}
                currentPath={currentPath}
                create={create}
                onOpen={onOpen}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
