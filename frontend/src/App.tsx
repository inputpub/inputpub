import { useMemo, useRef, useState } from 'react'
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
  const [configFor, setConfigFor] = useState<Destination | null>(null)

  const ctxFor = (dest: Destination) => ({
    getConfig: (key: string) => getConfig(dest.id, key),
    setConfig: (key: string, value: string) => setConfig(dest.id, key, value),
  })

  const isConfigured = (dest: Destination) =>
    !dest.config || dest.config.every((f) => !!getConfig(dest.id, f.key))

  async function run(dest: Destination) {
    const markdown = editorRef.current?.getMarkdown() ?? ''
    if (!markdown.trim()) {
      setStatus({ kind: 'error', text: '内容为空' })
      return
    }
    setBusy(dest.id)
    setStatus(null)
    try {
      const msg = await dest.send(markdown, ctxFor(dest))
      setStatus({ kind: 'ok', text: msg || `已发送到 ${dest.name}` })
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  function handleClick(dest: Destination) {
    if (!isConfigured(dest)) setConfigFor(dest)
    else void run(dest)
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">input.pub</span>
        <span className="tagline">input here, publish anywhere</span>
      </header>

      <main className="main">
        <Editor ref={editorRef} defaultValue={initialDraft} onChange={persist} />
      </main>

      <footer className="dock">
        <div className="targets">
          {destinations.map((dest) => (
            <button
              key={dest.id}
              type="button"
              className="target"
              title={dest.hint}
              disabled={busy !== null}
              onClick={() => handleClick(dest)}
            >
              <span className="target-icon">{dest.icon}</span>
              <span className="target-name">
                {busy === dest.id ? '…' : dest.name}
              </span>
            </button>
          ))}
        </div>
        {status && (
          <div className={`status ${status.kind}`} role="status">
            {status.text}
          </div>
        )}
      </footer>

      {configFor && (
        <ConfigDialog
          dest={configFor}
          onClose={() => setConfigFor(null)}
          onSaved={(dest) => {
            setConfigFor(null)
            void run(dest)
          }}
        />
      )}
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

export default App
