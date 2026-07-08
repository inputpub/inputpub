import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, type EditorHandle } from './components/Editor'
import { destinations, type Destination } from './destinations'
import {
  GearIcon,
  MoreIcon,
  ImageIcon,
  FeedbackIcon,
  MonitorIcon,
  SunIcon,
  MoonIcon,
  SparklesIcon,
  EditIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  FolderIcon,
  SendIcon,
} from './destinations/icons'
import { applyThemePref, getThemePref, nextThemePref, type ThemePref } from './lib/theme'
import { renderTemplate, templateVars } from './lib/template'
import { fieldLoc, findField, readField } from './lib/fields'
import { useDismiss } from './lib/useDismiss'
import {
  debounce,
  getConfig,
  getEnabled,
  getVaultSidebarOpen,
  loadDraft,
  saveDraft,
  setConfig,
  setEnabled,
  setVaultSidebarOpen as persistVaultSidebarOpen,
} from './lib/storage'
import {
  activeVaultBatchesWrites,
  expectReloadEcho,
  flushPendingVaultSave,
  getVaultSaveError,
  getVaultSaveState,
  onVaultSaveStateChange,
  openVaultFile,
  reopenLastVaultFile,
  resetVaultSaveState,
  stageVaultEdit,
} from './lib/vault'
import { Menu, MenuDivider, MenuItem } from './components/Menu'
import { Toast, type ToastStatus } from './components/Toast'
import { ConfigDialog } from './components/dialogs/ConfigDialog'
import { AiProviderDialog } from './components/dialogs/AiProviderDialog'
import { AiPromptsDialog } from './components/dialogs/AiPromptsDialog'
import { PromptDialog } from './components/dialogs/PromptDialog'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { ImageHostDialog } from './components/dialogs/ImageHostDialog'
import { ImageUploadDialog } from './components/dialogs/ImageUploadDialog'
import { VaultSidebar } from './components/VaultSidebar'
import type { VaultSaveState } from './lib/vault'

/** Delay before a clipboard destination opens the target, so the user reads the
 *  "copied" toast before the new tab takes focus. */
const CLIPBOARD_OPEN_DELAY = 2000

/** Rough mobile check — used only to tailor the copy hand-off (where there's no
 *  usable web admin / app deep link), not for anything security-sensitive. */
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

function App() {
  const editorRef = useRef<EditorHandle>(null)
  const persistDraft = useMemo(() => debounce(saveDraft, 400), [])
  // The editor seeds its content from this once per mount; bump editorKey to
  // remount it with fresh content (used by "Load content" and opening a vault file).
  const [seed, setSeed] = useState<string>(() => loadDraft())
  const [editorKey, setEditorKey] = useState(0)

  const [status, setStatus] = useState<ToastStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  // The tools menu drills into sub-views: "Publish" (the destination list) and
  // "Settings" (config entries — image host / AI — that are noise for users
  // who don't use those features).
  const [toolsView, setToolsView] = useState<'main' | 'publish' | 'settings'>('main')
  const [theme, setTheme] = useState<ThemePref>(getThemePref)
  const [imageHostOpen, setImageHostOpen] = useState(false)
  const [imageChoiceOpen, setImageChoiceOpen] = useState(false)
  const [aiProviderOpen, setAiProviderOpen] = useState(false)
  const [aiPromptsOpen, setAiPromptsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [configFor, setConfigFor] = useState<Destination | null>(null)
  const [promptFor, setPromptFor] = useState<Destination | null>(null)
  // The vault sidebar remembers its last open/closed state across reloads;
  // opening it shows either the "connect a vault" form or the file tree,
  // depending on connection state.
  const [vaultSidebarOpen, setVaultSidebarOpen] = useState(() => getVaultSidebarOpen() ?? false)
  // The path of the vault file currently loaded into the editor, if any —
  // when set, edits save to the vault instead of the local draft.
  const [vaultPath, setVaultPath] = useState<string | undefined>(undefined)
  const [vaultSaveState, setVaultSaveState] = useState<VaultSaveState>('idle')
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {}
    for (const d of destinations) m[d.id] = getEnabled(d.id) ?? d.defaultEnabled ?? true
    return m
  })
  const toolsRef = useRef<HTMLDivElement>(null)

  const closeTools = useCallback(() => {
    setToolsOpen(false)
    // Reset to the top level so it doesn't reopen inside a sub-view next time.
    setToolsView('main')
  }, [])
  useDismiss(toolsRef, closeTools, toolsOpen)

  // Swap the editor to new content (remount with a fresh seed) and record
  // which vault file it belongs to (undefined = the local draft).
  function showDocument(content: string, path: string | undefined) {
    setSeed(content)
    setEditorKey((k) => k + 1)
    setVaultPath(path)
  }

  // Remount the editor while keeping its current content — used when editor-time
  // config (e.g. the AI suggestion prompts, read once at mount) changes.
  function reloadEditor() {
    // Keeping the current content — the remount's normalized echo is a
    // baseline, not an edit (relevant when a vault file is open).
    if (vaultPath) expectReloadEcho()
    showDocument(editorRef.current?.getMarkdown() ?? seed, vaultPath)
  }

  function toggleEnabled(id: string, on: boolean) {
    setEnabled(id, on)
    setEnabledMap((m) => ({ ...m, [id]: on }))
  }

  // Auto-dismiss the status toast.
  useEffect(() => {
    if (!status) return
    const t = setTimeout(() => setStatus(null), 3500)
    return () => clearTimeout(t)
  }, [status])

  // On first mount, reopen whatever vault file was left open last session.
  // Auto-open the sidebar alongside it only for users who've never toggled
  // it — once they have, their stored preference wins.
  useEffect(() => {
    reopenLastVaultFile().then((opened) => {
      if (!opened) return
      showDocument(opened.content, opened.path)
      if (getVaultSidebarOpen() === undefined) setVaultSidebarOpen(true)
    })
  }, [])

  // Reflect lib/vault's save state (updated outside React, by the staging/
  // flush machinery) into the UI, and surface flush failures as a toast.
  useEffect(() => {
    return onVaultSaveStateChange((state) => {
      setVaultSaveState(state)
      if (state === 'error') {
        setStatus({ kind: 'error', text: getVaultSaveError() ?? "Couldn't save the file" })
      }
    })
  }, [])

  // Cmd/Ctrl+S: there's no Save button (edits already save themselves), but
  // the browser doesn't know that — left alone it pops up its own native
  // "Save Page As" dialog. Block that, and treat the shortcut as an explicit
  // checkpoint so a batched (e.g. GitHub) vault flushes right away instead of
  // waiting for its idle timeout.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void flushPendingVaultSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Flush a staged vault edit on natural checkpoints — losing focus or the
  // tab going hidden — so a batched (e.g. GitHub) save isn't only waiting on
  // its idle timeout. (Switching files/vaults already flushes internally,
  // in lib/vault.ts, before it changes what's active.)
  useEffect(() => {
    const flush = () => void flushPendingVaultSave()
    const onVisibility = () => {
      if (document.hidden) flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', flush)
    }
  }, [])

  // Closing/reloading the tab is different from the checkpoints above: the
  // page won't stay open long enough to reliably wait for a flush to finish.
  // For a batched (e.g. GitHub) vault with a save still pending, warn via the
  // browser's native "leave site?" prompt instead — for a local folder, a
  // write is already near-instant, so there's essentially never anything to
  // lose and the warning would just be noise.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      void flushPendingVaultSave()
      if (activeVaultBatchesWrites() && getVaultSaveState() !== 'idle' && getVaultSaveState() !== 'saved') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Stage every edit; lib/vault.ts decides when to actually save (batched
  // for providers like GitHub, near-instant for a local folder).
  const onEditorChange = useCallback(
    (markdown: string) => {
      if (vaultPath) {
        stageVaultEdit(markdown)
      } else {
        persistDraft(markdown)
      }
    },
    [vaultPath, persistDraft],
  )

  // Open a file from the vault sidebar into the editor. (openVaultFile
  // already flushes any pending edit on the previously open file first.)
  async function openVaultPath(path: string) {
    try {
      const content = await openVaultFile(path)
      showDocument(content, path)
      resetVaultSaveState()
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  // A file was just created in the sidebar — it's already open (and empty).
  function onVaultFileCreated(path: string) {
    showDocument('', path)
    resetVaultSaveState()
  }

  // A file was deleted in the sidebar — if it was open, fall back to the draft.
  function onVaultFileDeleted(path: string) {
    if (vaultPath === path) showDocument(loadDraft(), undefined)
  }

  // The active vault changed (connected, switched, reconfigured, or
  // disconnected) from the sidebar — if a vault file was open, it may no
  // longer belong to the active vault, so fall back to the local draft.
  function onVaultChanged() {
    if (vaultPath) showDocument(loadDraft(), undefined)
  }

  const ctxFor = (dest: Destination, input: Record<string, string>, markdown: string) => {
    const get = (key: string) => {
      const f = findField(dest, key)
      const [d, k] = f ? fieldLoc(dest, f) : [dest.id, key]
      return getConfig(d, k)
    }
    return {
      getConfig: get,
      setConfig: (key: string, value: string) => {
        const f = findField(dest, key)
        const [d, k] = f ? fieldLoc(dest, f) : [dest.id, key]
        setConfig(d, k, value)
      },
      input,
      slot: (key: string) => {
        const f = findField(dest, key)
        const stored = (get(key) ?? '').trim()
        const template = stored || f?.default || '{{ body }}'
        return renderTemplate(template, templateVars(markdown, input))
      },
    }
  }

  const isConfigured = (dest: Destination) =>
    !dest.config || dest.config.every((f) => f.optional || !!readField(dest, f))

  async function run(dest: Destination, input: Record<string, string> = {}) {
    const markdown = editorRef.current?.getMarkdown() ?? ''
    if (!markdown.trim()) {
      setStatus({ kind: 'error', text: 'Nothing to publish' })
      return
    }
    setBusy(dest.id)
    setStatus(null)
    try {
      // Copy-and-paste destinations: copy, show a prominent toast, then open the
      // target after a beat so the user reads the toast before the new tab takes
      // focus. Open in a new tab so the editor (and the just-copied draft) stays
      // put; if the popup is blocked, fall back to same-tab navigation. Copy
      // must run while this tab is focused, so it happens before the tab opens.
      if (dest.clipboard) {
        const text = ctxFor(dest, input, markdown).slot('content')
        let copied = false
        try {
          if (dest.clipboard.format === 'mp-html') {
            // Rich-text paste: HTML as text/html, raw Markdown as the fallback.
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/html': new Blob([text], { type: 'text/html' }),
                'text/plain': new Blob([markdown], { type: 'text/plain' }),
              }),
            ])
          } else {
            await navigator.clipboard.writeText(text)
          }
          copied = true
        } catch {
          // clipboard may be unavailable; still send the user over
        }
        // On mobile, WeChat's web admin is unusable and there's no public way
        // to deep-link the "订阅号助手" app — so just guide the user to open it
        // and paste, rather than navigating to a dead-end web page.
        if (isMobile && dest.clipboard.format === 'mp-html') {
          setStatus({
            kind: 'ok',
            big: true,
            text: copied
              ? 'Copied. Open the WeChat “订阅号助手” app and paste into a new article.'
              : 'Copy your text, then open the WeChat “订阅号助手” app and paste into a new article.',
          })
          return
        }
        setStatus({
          kind: 'ok',
          big: true,
          text: copied
            ? `Copied to clipboard. Opening ${dest.name} — paste it there.`
            : `Opening ${dest.name} — copy your text and paste it there.`,
        })
        const { url } = dest.clipboard
        setTimeout(() => {
          // The click's user activation (~5s) is still valid here, so the new
          // tab isn't popup-blocked; if it is, navigate this tab instead.
          if (!window.open(url, '_blank')) window.location.href = url
        }, CLIPBOARD_OPEN_DELAY)
        return
      }
      const msg = await dest.send?.(markdown, ctxFor(dest, input, markdown))
      setStatus({ kind: 'ok', text: msg || `Sent to ${dest.name}` })
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  // After config is satisfied, either collect publish-time input or run directly.
  function proceed(dest: Destination) {
    if (dest.prompt?.length) setPromptFor(dest)
    else void run(dest)
  }

  function pick(dest: Destination) {
    if (busy) return
    closeTools()
    if (!isConfigured(dest)) setConfigFor(dest)
    else proceed(dest)
  }

  return (
    // --sheet-max / --page-pad are the single source of truth for the sheet
    // width + horizontal gutter; the sheet, the fixed top bar, and the floating
    // vault sidebar all derive their position from these, so everything lines
    // up with the sheet's edges at any width.
    <div className="relative min-h-dvh [--page-pad:1rem] [--sheet-max:820px] max-[700px]:[--page-pad:0.75rem]">
      {vaultSidebarOpen && (
        <VaultSidebar
          currentPath={vaultPath}
          onOpen={(path) => void openVaultPath(path)}
          onCreated={onVaultFileCreated}
          onDeleted={onVaultFileDeleted}
          onVaultChanged={onVaultChanged}
          onError={(text) => setStatus({ kind: 'error', text })}
        />
      )}
      {/* Top bar: scrolls with the page (absolute, not fixed) so the buttons
          never cover the text once you scroll down. Its inner edges align with
          the centered sheet (same max-width + horizontal padding as the sheet
          area). Empty area lets clicks pass through; the two groups re-enable
          pointer events. */}
      <div className="pointer-events-none absolute inset-x-0 top-4 z-40 mx-auto flex max-w-[calc(var(--sheet-max)+2*var(--page-pad))] items-start justify-between px-[var(--page-pad)]">
        <div className="pointer-events-auto relative">
          <button
            type="button"
            className={`inline-flex cursor-pointer items-center justify-center rounded-md border border-transparent px-2 py-[0.3rem] text-muted opacity-60 transition duration-150 hover:bg-hover hover:text-text hover:opacity-100 ${vaultSidebarOpen ? 'bg-hover text-text opacity-100' : ''}`}
            aria-pressed={vaultSidebarOpen}
            aria-label="Toggle vault"
            title="Vault"
            onClick={() => {
              const next = !vaultSidebarOpen
              setVaultSidebarOpen(next)
              persistVaultSidebarOpen(next)
            }}
          >
            <span className="inline-flex text-[1.15rem] leading-none [&_svg]:block [&_svg]:size-[1em]">
              {FolderIcon}
            </span>
          </button>
        </div>

        <div className="pointer-events-auto flex items-start gap-2">
          <div className="relative" ref={toolsRef}>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center justify-center rounded-md border border-transparent px-2 py-[0.3rem] text-muted opacity-60 transition duration-150 hover:bg-hover hover:text-text hover:opacity-100"
              aria-haspopup="menu"
              aria-expanded={toolsOpen}
              aria-label="More"
              onClick={() => setToolsOpen((o) => !o)}
            >
              <span className="inline-flex text-[1.15rem] leading-none [&_svg]:block [&_svg]:size-[1em]">
                {MoreIcon}
              </span>
            </button>
            {toolsOpen && (
              <Menu>
                {toolsView === 'main' ? (
                  <>
                    <MenuItem
                      icon={SendIcon}
                      trailing={ChevronRightIcon}
                      onClick={() => setToolsView('publish')}
                    >
                      {busy ? 'Publishing…' : 'Publish to'}
                    </MenuItem>
                    <MenuDivider />
                    <MenuItem
                      icon={
                        theme === 'system' ? MonitorIcon : theme === 'light' ? SunIcon : MoonIcon
                      }
                      title="Switch color theme"
                      onClick={() => {
                        const next = nextThemePref(theme)
                        setTheme(next)
                        applyThemePref(next)
                      }}
                    >
                      Theme: {theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark'}
                    </MenuItem>
                    <MenuItem
                      icon={GearIcon}
                      trailing={ChevronRightIcon}
                      onClick={() => setToolsView('settings')}
                    >
                      Settings
                    </MenuItem>
                    <MenuDivider />
                    <MenuItem
                      icon={FeedbackIcon}
                      href="https://bodhi.wtf/token/0xD6347200EEdB3f64bBdd2C363894dd043a24a488"
                      onClick={() => closeTools()}
                    >
                      Feedback
                    </MenuItem>
                  </>
                ) : toolsView === 'publish' ? (
                  <>
                    <MenuItem icon={ChevronLeftIcon} onClick={() => setToolsView('main')}>
                      Back
                    </MenuItem>
                    <MenuDivider />
                    {destinations
                      .filter((dest) => enabledMap[dest.id])
                      .map((dest) => (
                        <MenuItem
                          key={dest.id}
                          icon={dest.icon}
                          title={dest.hint}
                          onClick={() => pick(dest)}
                        >
                          {dest.name}
                        </MenuItem>
                      ))}
                    <MenuDivider />
                    <MenuItem
                      icon={GearIcon}
                      onClick={() => {
                        closeTools()
                        setSettingsOpen(true)
                      }}
                    >
                      Customize
                    </MenuItem>
                  </>
                ) : (
                  <>
                    <MenuItem icon={ChevronLeftIcon} onClick={() => setToolsView('main')}>
                      Back
                    </MenuItem>
                    <MenuDivider />
                    <MenuItem
                      icon={ImageIcon}
                      onClick={() => {
                        closeTools()
                        setImageHostOpen(true)
                      }}
                    >
                      Image Host
                    </MenuItem>
                    <MenuItem
                      icon={SparklesIcon}
                      onClick={() => {
                        closeTools()
                        setAiProviderOpen(true)
                      }}
                    >
                      AI Provider
                    </MenuItem>
                    <MenuItem
                      icon={EditIcon}
                      onClick={() => {
                        closeTools()
                        setAiPromptsOpen(true)
                      }}
                    >
                      AI Prompts
                    </MenuItem>
                  </>
                )}
              </Menu>
            )}
          </div>
        </div>
      </div>

      {/* A4-ish sheet: runs flush to the bottom of the window (no bottom gap,
          squared bottom corners), then grows with content. */}
      <main className="flex min-h-dvh justify-center bg-backdrop px-[var(--page-pad)] pt-16">
        <div className="flex h-max min-h-[calc(100dvh-4rem)] w-full max-w-[var(--sheet-max)] flex-col border-[0.5px] shadow-md border-edge bg-paper px-[85px] py-12  max-[700px]:px-5 max-[700px]:pb-8 max-[700px]:pt-7">
          {vaultPath && (
            <div className="mb-3 flex items-center gap-2 text-[0.78rem] text-muted">
              <span className="truncate">{vaultPath}</span>
              {/* A local-folder save is an instant disk write with nothing
                  meaningful to report — only batched (e.g. GitHub) vaults,
                  where a save can sit staged for a while, need this. */}
              {activeVaultBatchesWrites() &&
                (vaultSaveState === 'dirty' ? (
                  <button
                    type="button"
                    className="group -my-1 -mr-1 shrink-0 cursor-pointer rounded px-1 py-1 opacity-70 hover:bg-hover hover:text-text hover:opacity-100"
                    onClick={() => void flushPendingVaultSave()}
                  >
                    <span className="group-hover:hidden">Unsaved changes</span>
                    <span className="hidden group-hover:inline">Save now</span>
                  </button>
                ) : (
                  <span className="shrink-0 opacity-70">
                    {vaultSaveState === 'saving' && 'Saving…'}
                    {vaultSaveState === 'saved' && 'Saved'}
                    {vaultSaveState === 'error' && 'Save failed'}
                  </span>
                ))}
            </div>
          )}
          <Editor
            key={editorKey}
            ref={editorRef}
            defaultValue={seed}
            onChange={onEditorChange}
            onImageUploadUnconfigured={() => setImageChoiceOpen(true)}
            onImageUploadError={(text) => setStatus({ kind: 'error', text })}
            onAiUnconfigured={() => setAiProviderOpen(true)}
            onAiError={(text) => setStatus({ kind: 'error', text })}
            onEditPrompts={() => setAiPromptsOpen(true)}
          />
        </div>
      </main>

      {status && <Toast status={status} />}

      {configFor && (
        <ConfigDialog
          dest={configFor}
          onClose={() => setConfigFor(null)}
          onSaved={(dest) => {
            setConfigFor(null)
            proceed(dest)
          }}
        />
      )}

      {promptFor && (
        <PromptDialog
          dest={promptFor}
          onCancel={() => setPromptFor(null)}
          onSubmit={(dest, values) => {
            setPromptFor(null)
            void run(dest, values)
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          enabled={enabledMap}
          onToggle={toggleEnabled}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {imageChoiceOpen && (
        <ImageUploadDialog
          onClose={() => setImageChoiceOpen(false)}
          onConfigure={() => {
            setImageChoiceOpen(false)
            setImageHostOpen(true)
          }}
          onUpgrade={() => {
            window.location.href = '/pro'
          }}
        />
      )}

      {imageHostOpen && <ImageHostDialog onClose={() => setImageHostOpen(false)} />}

      {aiProviderOpen && <AiProviderDialog onClose={() => setAiProviderOpen(false)} />}

      {aiPromptsOpen && (
        <AiPromptsDialog onClose={() => setAiPromptsOpen(false)} onSaved={reloadEditor} />
      )}
    </div>
  )
}

export default App
