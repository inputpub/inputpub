import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, type EditorHandle } from './components/Editor'
import { destinations, type Destination } from './destinations'
import {
  GearIcon,
  MoreIcon,
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
  GitHubIcon,
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
import { inlineVaultImages, releaseVaultImages, warmVaultImages } from './lib/vaultImages'
import { Menu, MenuDivider, MenuItem } from './components/Menu'
import { Toast, type ToastStatus } from './components/Toast'
import { ConfigDialog } from './components/dialogs/ConfigDialog'
import { AiProviderDialog } from './components/dialogs/AiProviderDialog'
import { AiPromptsDialog } from './components/dialogs/AiPromptsDialog'
import { PromptDialog } from './components/dialogs/PromptDialog'
import { SettingsDialog } from './components/dialogs/SettingsDialog'
import { VaultSidebar, SIDEBAR_DRAWER_QUERY } from './components/VaultSidebar'
import { useMediaQuery } from './lib/useMediaQuery'
import { useDrawerSwipe } from './lib/useDrawerSwipe'
import { FilePreview } from './components/FilePreview'
import { isTextPath } from './vault'
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
  // Whether the next editor (re)mount should grab focus — set true when the
  // remount is from opening/creating a file, so the cursor lands ready to type.
  const [focusMount, setFocusMount] = useState(false)
  // True while a vault file is being fetched (GitHub reads have real latency):
  // the path switches to the new file immediately and the old content is
  // cleared for a spinner, then swapped for the file once it arrives.
  const [loadingFile, setLoadingFile] = useState(false)

  const [status, setStatus] = useState<ToastStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  // The tools menu drills into one sub-view: "Publish" (the destination list).
  const [toolsView, setToolsView] = useState<'main' | 'publish'>('main')
  const [theme, setTheme] = useState<ThemePref>(getThemePref)
  const [aiProviderOpen, setAiProviderOpen] = useState(false)
  const [aiPromptsOpen, setAiPromptsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [configFor, setConfigFor] = useState<Destination | null>(null)
  const [promptFor, setPromptFor] = useState<Destination | null>(null)
  // The vault sidebar remembers its last open/closed state across reloads;
  // opening it shows either the "connect a vault" form or the file tree,
  // depending on connection state.
  const [vaultSidebarOpen, setVaultSidebarOpen] = useState(() => getVaultSidebarOpen() ?? false)
  // Keep the sidebar mounted once it's first shown, so toggling it closed then
  // open again just hides/reveals it (CSS) rather than unmounting — unmounting
  // drops the loaded file tree and forces a fresh API fetch on every reopen.
  // Stays false until the first open, so a user who never opens it pays no fetch.
  const [vaultSidebarMounted, setVaultSidebarMounted] = useState(vaultSidebarOpen)
  // Narrow enough that the sidebar overlays the sheet rather than sitting in the
  // gutter beside it — at which point it behaves as a drawer (scrim, closes on
  // an outside tap, closes once a file is opened) instead of as a fixed panel.
  const sidebarIsDrawer = useMediaQuery(SIDEBAR_DRAWER_QUERY)
  const shellRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Latch the two together here rather than in an effect watching `open` —
  // that would set state during render-commit and cascade an extra render.
  const showVaultSidebar = useCallback((open: boolean) => {
    setVaultSidebarOpen(open)
    if (open) setVaultSidebarMounted(true)
  }, [])
  // The path of the vault file currently loaded into the editor, if any —
  // when set, edits save to the vault instead of the local draft.
  const [vaultPath, setVaultPath] = useState<string | undefined>(undefined)
  // A non-editable file being previewed, shown instead of the editor while set.
  // Kept apart from vaultPath so the open note — and its unsaved edits —
  // survive a detour through an image.
  const [previewPath, setPreviewPath] = useState<string | null>(null)
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

  // Swipe the drawer open from the screen edge, and shut from anywhere. Written
  // straight to the DOM rather than through state: this fires every frame of the
  // drag, and re-rendering the editor at that rate is not something to attempt.
  const onDrawerProgress = useCallback((progress: number | null, dragging: boolean) => {
    const shell = shellRef.current
    if (!shell) return
    if (progress === null) shell.style.removeProperty('--drawer-progress')
    else shell.style.setProperty('--drawer-progress', String(progress))
    shell.toggleAttribute('data-drawer-dragging', dragging)
  }, [])
  const onDrawerSettle = useCallback(
    (open: boolean) => {
      showVaultSidebar(open)
      persistVaultSidebarOpen(open)
    },
    [showVaultSidebar],
  )
  // Mount on the first touch that could become a swipe, not on the swipe: the
  // panel has to be in the DOM to be measured, and a user whose last session
  // left it closed would otherwise have nothing to pull. Mounting doesn't open
  // it, so the only cost of a touch that turns out to be a scroll is the tree
  // fetch — which that user was one tap away from paying anyway.
  const onDrawerReach = useCallback(() => setVaultSidebarMounted(true), [])
  useDrawerSwipe({
    enabled: sidebarIsDrawer,
    open: vaultSidebarOpen,
    panelRef,
    onReach: onDrawerReach,
    onProgress: onDrawerProgress,
    onSettle: onDrawerSettle,
  })
  // The other writer of --drawer-progress: the button, the scrim, opening a
  // file. The gesture has already written the same value by the time this runs
  // after a swipe, so it lands as a no-op there and drives the whole animation
  // everywhere else.
  useEffect(() => {
    shellRef.current?.style.setProperty('--drawer-progress', vaultSidebarOpen ? '1' : '0')
  }, [vaultSidebarOpen])

  // Swap the editor to new content (remount with a fresh seed) and record
  // which vault file it belongs to (undefined = the local draft).
  function showDocument(content: string, path: string | undefined, focus = false) {
    setSeed(content)
    setEditorKey((k) => k + 1)
    setVaultPath(path)
    setFocusMount(focus)
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
    reopenLastVaultFile().then(async (opened) => {
      if (!opened) return
      // Same reason as in openVaultPath: have the images in hand before the
      // editor mounts, or each renders broken first.
      await warmVaultImages(opened.content)
      showDocument(opened.content, opened.path)
      if (getVaultSidebarOpen() === undefined) showVaultSidebar(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // browser's native "leave site?" prompt instead — a store that writes on
  // every edit has nothing pending to lose, so it skips the warning.
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

  // Stage every edit; lib/vault.ts decides when to actually save (batched for
  // providers like GitHub, where each save is a commit).
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
  // Switch the shown path and clear the old content up front (with a spinner),
  // so a slow GitHub read doesn't leave the previous file lingering.
  async function openVaultPath(path: string) {
    // As a drawer, the sidebar covers the very thing that was just opened — so
    // step out of the way. Deliberately not persisted: the stored preference is
    // the user's own last toggle, and the drawer getting out of its own way
    // shouldn't overwrite it (they'd find it closed on the desktop next time).
    if (sidebarIsDrawer) setVaultSidebarOpen(false)
    // Only text is editable; everything else is previewed (or reported as
    // un-previewable). Show it *over* the open note rather than in place of it:
    // the note stays open in lib/vault, so a staged edit still flushes and
    // closing the preview returns to it untouched.
    if (!isTextPath(path)) {
      setPreviewPath(path)
      return
    }
    setPreviewPath(null)
    const prev = vaultPath
    setVaultPath(path)
    setLoadingFile(true)
    try {
      const content = await openVaultFile(path)
      // Pull the note's images down before mounting the editor, so it can paint
      // them on the first frame instead of showing each one broken while its
      // bytes are fetched. Folded into the spinner that's already up for the
      // note read, and time-bounded, so it can only ever cost a moment.
      await warmVaultImages(content)
      showDocument(content, path, true)
      resetVaultSaveState()
    } catch (err) {
      setVaultPath(prev) // load failed — the old document is still what's shown
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoadingFile(false)
    }
  }

  // A file was just created in the sidebar — it's already open (and empty), so
  // focus it to start typing right away.
  function onVaultFileCreated(path: string) {
    showDocument('', path, true)
    resetVaultSaveState()
  }

  // A file was deleted in the sidebar — if it was open, fall back to the draft.
  function onVaultFileDeleted(path: string) {
    if (previewPath === path || (previewPath && previewPath.startsWith(`${path}/`))) {
      setPreviewPath(null)
    }
    if (vaultPath === path) showDocument(loadDraft(), undefined)
  }

  // A file or folder was renamed in the sidebar — if the open document is it
  // (or lives under a renamed folder), re-point vaultPath so edits keep saving
  // to the right place. The content is unchanged, so no editor remount.
  function onVaultRenamed(from: string, to: string) {
    const repoint = <T extends string | undefined | null>(cur: T): T => {
      if (!cur) return cur
      if (cur === from) return to as T
      if (cur.startsWith(`${from}/`)) return `${to}/${cur.slice(from.length + 1)}` as T
      return cur
    }
    setVaultPath(repoint)
    setPreviewPath(repoint)
  }

  // The active vault changed (connected, switched, reconfigured, or
  // disconnected) from the sidebar — if a vault file was open, it may no
  // longer belong to the active vault, so fall back to the local draft.
  function onVaultChanged() {
    // Cached image blobs belong to the vault that's going away — drop them so a
    // path that exists in both repos can't show the old one's bytes.
    releaseVaultImages()
    setPreviewPath(null)
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
            // Vault images are inlined as data: URIs so they survive the paste
            // (see inlineVaultImages). That read can outlast the click's user
            // activation, so it goes *inside* ClipboardItem as a promise —
            // awaiting it before write() would risk losing permission to copy.
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/html': inlineVaultImages(text).then(
                  (html) => new Blob([html], { type: 'text/html' }),
                ),
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
    <div
      ref={shellRef}
      // drawer-shell owns --drawer-progress, which index.css turns into the
      // drawer's offset, the page's shift and the scrim's opacity at once.
      className="drawer-shell relative min-h-dvh [--page-pad:1rem] [--sheet-max:820px] max-[700px]:[--page-pad:0.75rem]"
      data-drawer={vaultSidebarOpen ? 'open' : 'shut'}
    >
      {vaultSidebarMounted && (
        <VaultSidebar
          panelRef={panelRef}
          visible={vaultSidebarOpen}
          // Dismissing the drawer by tapping outside it is a deliberate choice,
          // unlike the automatic close in openVaultPath — so it's remembered.
          onClose={() => {
            showVaultSidebar(false)
            persistVaultSidebarOpen(false)
          }}
          currentPath={previewPath ?? vaultPath}
          onOpen={(path) => void openVaultPath(path)}
          onCreated={onVaultFileCreated}
          onDeleted={onVaultFileDeleted}
          onRenamed={onVaultRenamed}
          onVaultChanged={onVaultChanged}
          onError={(text) => setStatus({ kind: 'error', text })}
        />
      )}
      {/* Everything the drawer pushes aside. The toast and the dialogs are
          deliberately outside it: they're fixed and centred on the viewport, and
          a translated ancestor would drag them along and re-anchor them. */}
      <div className="drawer-shift">
      {/* Top bar: scrolls with the page (absolute, not fixed) so the buttons
          never cover the text once you scroll down. Its inner edges align with
          the centered sheet (same max-width + horizontal padding as the sheet
          area). Empty area lets clicks pass through; the two groups re-enable
          pointer events. */}
      <div className="pointer-events-none absolute inset-x-0 top-[calc(1rem+env(safe-area-inset-top))] z-40 mx-auto flex max-w-[calc(var(--sheet-max)+2*var(--page-pad))] items-start justify-between px-[var(--page-pad)]">
        <div className="pointer-events-auto relative">
          <button
            type="button"
            className={`inline-flex cursor-pointer items-center justify-center rounded-control border border-transparent px-2 py-1 text-nav-muted opacity-60 transition duration-150 pointer-coarse:px-2.5 pointer-coarse:py-2 hover:bg-hover hover:text-nav-active hover:opacity-100 ${vaultSidebarOpen ? 'bg-hover text-nav-active opacity-100' : ''}`}
            aria-pressed={vaultSidebarOpen}
            aria-label="Toggle vault"
            title="Vault"
            onClick={() => {
              const next = !vaultSidebarOpen
              showVaultSidebar(next)
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
              className="inline-flex cursor-pointer items-center justify-center rounded-control border border-transparent px-2 py-1 text-nav-muted opacity-60 transition duration-150 pointer-coarse:px-2.5 pointer-coarse:py-2 hover:bg-hover hover:text-nav-active hover:opacity-100"
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
                    <MenuDivider />
                    <MenuItem
                      icon={FeedbackIcon}
                      href="https://bodhi.wtf/token/0xD6347200EEdB3f64bBdd2C363894dd043a24a488"
                      onClick={() => closeTools()}
                    >
                      $INPUT
                    </MenuItem>
                    <MenuItem
                      icon={GitHubIcon}
                      href="https://github.com/inputpub/inputpub"
                      onClick={() => closeTools()}
                    >
                      Source code
                    </MenuItem>
                  </>
                ) : (
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
                )}
              </Menu>
            )}
          </div>
        </div>
      </div>

      {/* A4-ish sheet: runs flush to the bottom of the window (no bottom gap,
          squared bottom corners), then grows with content. Only the top corners
          are rounded — the bottom edge isn't an edge, it's where the page keeps
          going, and curving it would draw a line that isn't there. */}
      <main className="flex min-h-dvh justify-center bg-backdrop pt-[calc(4rem+env(safe-area-inset-top))] pl-[max(var(--page-pad),env(safe-area-inset-left))] pr-[max(var(--page-pad),env(safe-area-inset-right))]">
        <div className="flex h-max min-h-[calc(100dvh-4rem-env(safe-area-inset-top))] w-full max-w-[var(--sheet-max)] flex-col rounded-t-surface border-[0.5px] shadow-raised border-edge bg-paper px-[85px] py-12  max-[700px]:px-5 max-[700px]:pb-8 max-[700px]:pt-7">
          {(previewPath ?? vaultPath) && (
            <div className="mb-3 flex items-center gap-2 text-[0.78rem] text-nav-muted">
              <span className="truncate">{previewPath ?? vaultPath}</span>
              {previewPath ? (
                <button
                  type="button"
                  className="-my-1 -mr-1 shrink-0 cursor-pointer rounded-item px-1 py-1 opacity-70 hover:text-nav-active hover:opacity-100"
                  onClick={() => setPreviewPath(null)}
                >
                  Close
                </button>
              ) : loadingFile ? (
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
              ) : (
                /* Only batched (e.g. GitHub) vaults, where a save can sit
                   staged for a while, have anything worth reporting here — a
                   save-on-every-edit store is always already up to date. */
                activeVaultBatchesWrites() &&
                (vaultSaveState === 'dirty' ? (
                  /* On a pointer this reads as a status line and offers the
                     action on hover. Touch has no hover to offer it with, so
                     "Unsaved changes" would just look like text — there it
                     states the action outright, and takes a border and a real
                     tap target to look like the button it has always been. */
                  <button
                    type="button"
                    className="group -my-1 -mr-1 shrink-0 cursor-pointer rounded-item px-1 py-1 opacity-70 pointer-coarse:-my-2 pointer-coarse:border pointer-coarse:border-line pointer-coarse:px-2 pointer-coarse:py-1.5 pointer-coarse:opacity-100 hover:text-nav-active hover:opacity-100"
                    onClick={() => void flushPendingVaultSave()}
                  >
                    <span className="pointer-coarse:hidden group-hover:hidden">Unsaved changes</span>
                    <span className="hidden pointer-coarse:inline group-hover:inline">Save now</span>
                  </button>
                ) : (
                  <span className="shrink-0 opacity-70">
                    {vaultSaveState === 'saving' && 'Saving…'}
                    {vaultSaveState === 'saved' && 'Saved'}
                    {vaultSaveState === 'error' && 'Save failed'}
                  </span>
                )))}
            </div>
          )}
          {loadingFile ? (
            // Old content cleared; the spinner beside the path shows progress.
            <div className="flex-1" />
          ) : (
            <>
              {/* Hidden rather than unmounted while previewing: a remount would
                  reseed the editor from the last *loaded* content, discarding
                  anything typed since — and then emit that stale text as an
                  edit. Looking at an image must not touch the open note. */}
              <div className={`flex min-w-0 flex-1 flex-col ${previewPath ? 'hidden' : ''}`}>
                <Editor
                  key={editorKey}
                  ref={editorRef}
                  defaultValue={seed}
                  autoFocus={focusMount}
                  onChange={onEditorChange}
                  onImageUploadUnavailable={() =>
                    setStatus({
                      kind: 'error',
                      text: 'Open a file in your repo first — images are saved into it.',
                    })
                  }
                  onImageUploadError={(text) => setStatus({ kind: 'error', text })}
                  onAiUnconfigured={() => setAiProviderOpen(true)}
                  onAiError={(text) => setStatus({ kind: 'error', text })}
                  onEditPrompts={() => setAiPromptsOpen(true)}
                />
              </div>
              {previewPath && <FilePreview key={previewPath} path={previewPath} />}
            </>
          )}
        </div>
      </main>
      </div>

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

      {aiProviderOpen && <AiProviderDialog onClose={() => setAiProviderOpen(false)} />}

      {aiPromptsOpen && (
        <AiPromptsDialog onClose={() => setAiPromptsOpen(false)} onSaved={reloadEditor} />
      )}
    </div>
  )
}

export default App
