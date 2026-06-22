import { useEffect, useMemo, useRef, useState } from 'react'
import { Editor, type EditorHandle } from './components/Editor'
import { destinations, type Destination } from './destinations'
import {
  debounce,
  getConfig,
  loadDraft,
  saveDraft,
  setConfig,
} from './lib/storage'
import './App.css'

type Status = { kind: 'ok' | 'error'; text: string } | null

function App() {
  const editorRef = useRef<EditorHandle>(null)
  const initialDraft = useMemo(() => loadDraft(), [])
  const persist = useMemo(() => debounce(saveDraft, 400), [])

  const [status, setStatus] = useState<Status>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [configFor, setConfigFor] = useState<Destination | null>(null)
  const [promptFor, setPromptFor] = useState<Destination | null>(null)
  const publishRef = useRef<HTMLDivElement>(null)

  // Close the publish menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!publishRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Auto-dismiss the status toast.
  useEffect(() => {
    if (!status) return
    const t = setTimeout(() => setStatus(null), 3500)
    return () => clearTimeout(t)
  }, [status])

  const ctxFor = (dest: Destination, input: Record<string, string>) => ({
    getConfig: (key: string) => getConfig(dest.id, key),
    setConfig: (key: string, value: string) => setConfig(dest.id, key, value),
    input,
  })

  const isConfigured = (dest: Destination) =>
    !dest.config || dest.config.every((f) => f.optional || !!getConfig(dest.id, f.key))

  async function run(dest: Destination, input: Record<string, string> = {}) {
    const markdown = editorRef.current?.getMarkdown() ?? ''
    if (!markdown.trim()) {
      setStatus({ kind: 'error', text: '内容为空' })
      return
    }
    setBusy(dest.id)
    setStatus(null)
    try {
      const msg = await dest.send(markdown, ctxFor(dest, input))
      setStatus({ kind: 'ok', text: msg || `已发送到 ${dest.name}` })
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
    setMenuOpen(false)
    if (!isConfigured(dest)) setConfigFor(dest)
    else proceed(dest)
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="publish" ref={publishRef}>
          <button
            type="button"
            className="publish-btn"
            disabled={busy !== null}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span>{busy ? '发布中…' : 'Publish'}</span>
            <svg
              className="publish-caret"
              width="12"
              height="12"
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
          {menuOpen && (
            <div className="publish-menu" role="menu">
              {destinations.map((dest) => (
                <button
                  key={dest.id}
                  type="button"
                  role="menuitem"
                  className="publish-item"
                  title={dest.hint}
                  onClick={() => pick(dest)}
                >
                  <span className="publish-item-icon">{dest.icon}</span>
                  <span className="publish-item-name">{dest.name}</span>
                </button>
              ))}
              <div className="publish-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="publish-item"
                onClick={() => {
                  setMenuOpen(false)
                  setSettingsOpen(true)
                }}
              >
                <span className="publish-item-icon">⚙️</span>
                <span className="publish-item-name">设置</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <main className="sheet-area">
        <div className="sheet">
          <Editor ref={editorRef} defaultValue={initialDraft} onChange={persist} />
        </div>
      </main>

      {status && (
        <div className={`toast ${status.kind}`} role="status">
          {status.text}
        </div>
      )}

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

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

function ConfigDialog({
  dest,
  onClose,
  onSaved,
}: {
  dest: Destination
  onClose: () => void
  onSaved: (dest: Destination) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((dest.config ?? []).map((f) => [f.key, getConfig(dest.id, f.key) ?? ''])),
  )

  const canSave = (dest.config ?? []).every((f) => values[f.key]?.trim())

  function save() {
    for (const f of dest.config ?? []) setConfig(dest.id, f.key, values[f.key].trim())
    onSaved(dest)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>
          {dest.icon} {dest.name} 配置
        </h2>
        <p className="dialog-note">仅保存在本浏览器（localStorage），不会上传。</p>
        {(dest.config ?? []).map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <input
              type={f.type ?? 'text'}
              placeholder={f.placeholder}
              value={values[f.key]}
              autoFocus
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) save()
              }}
            />
            {f.hint && <span className="field-hint">{f.hint}</span>}
          </label>
        ))}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" disabled={!canSave} onClick={save}>
            保存并发送
          </button>
        </div>
      </div>
    </div>
  )
}

function PromptDialog({
  dest,
  onCancel,
  onSubmit,
}: {
  dest: Destination
  onCancel: () => void
  onSubmit: (dest: Destination, values: Record<string, string>) => void
}) {
  const fields = dest.prompt ?? []
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  )
  const canSubmit = fields.every((f) => f.optional || values[f.key]?.trim())

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>
          {dest.icon} 发布到 {dest.name}
        </h2>
        {fields.map((f, i) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <input
              type={f.type ?? 'text'}
              placeholder={f.placeholder}
              value={values[f.key]}
              autoFocus={i === 0}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) onSubmit(dest, values)
              }}
            />
          </label>
        ))}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            取消
          </button>
          <button type="button" disabled={!canSubmit} onClick={() => onSubmit(dest, values)}>
            发布
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  // Destinations that need credentials (currently GitHub Gist's token).
  const configurable = destinations.filter((d) => d.config?.length)
  const fieldId = (destId: string, key: string) => `${destId}.${key}`

  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {}
    for (const d of configurable)
      for (const f of d.config ?? []) v[fieldId(d.id, f.key)] = getConfig(d.id, f.key) ?? ''
    return v
  })
  const [saved, setSaved] = useState(false)

  function save() {
    for (const d of configurable)
      for (const f of d.config ?? [])
        setConfig(d.id, f.key, (values[fieldId(d.id, f.key)] ?? '').trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>设置</h2>
        <p className="dialog-note">所有配置仅保存在本浏览器（localStorage），不会上传。</p>
        {configurable.map((d) => (
          <div key={d.id}>
            <div className="settings-group-title">
              {d.icon} {d.name}
            </div>
            {(d.config ?? []).map((f) => (
              <label key={f.key} className="field">
                <span>{f.label}</span>
                <input
                  type={f.type ?? 'text'}
                  placeholder={f.placeholder}
                  value={values[fieldId(d.id, f.key)]}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [fieldId(d.id, f.key)]: e.target.value }))
                  }
                />
                {f.hint && <span className="field-hint">{f.hint}</span>}
              </label>
            ))}
          </div>
        ))}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
          <button type="button" onClick={save}>
            {saved ? '已保存' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
