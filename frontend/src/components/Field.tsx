import type { ConfigField } from '../destinations/types'

// A single labelled form control (text input or textarea) plus optional hint.
// One place to change how every config/prompt field looks and behaves.

const fieldCls = 'flex flex-col gap-1 text-[0.82rem]'
const inputCls =
  'rounded-control border border-line bg-bg px-2.5 py-2 text-inherit focus:border-accent focus:outline-none'
const textareaCls =
  'min-h-[5.5rem] resize-y whitespace-pre rounded-control border border-line bg-bg px-2.5 py-2 font-mono text-[0.76rem] leading-normal [overflow-wrap:normal] focus:border-accent focus:outline-none'
const hintCls =
  'text-[0.72rem] leading-snug text-muted [&_a]:text-text [&_a]:underline [&_code]:rounded-item [&_code]:bg-hover [&_code]:px-[0.3em] [&_code]:py-[0.05em] [&_code]:text-[0.92em]'

export function Field({
  field,
  value,
  onChange,
  autoFocus,
  onEnter,
}: {
  field: ConfigField
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  /** Called when Enter is pressed in a text input (not textarea). */
  onEnter?: () => void
}) {
  return (
    <label className={fieldCls}>
      <span>{field.label}</span>
      {field.type === 'textarea' ? (
        <textarea
          className={textareaCls}
          placeholder={field.placeholder ?? field.default}
          value={value}
          rows={6}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={inputCls}
          type={field.type ?? 'text'}
          placeholder={field.placeholder ?? field.default}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onEnter ? (e) => e.key === 'Enter' && onEnter() : undefined}
        />
      )}
      {field.hint && <span className={hintCls}>{field.hint}</span>}
    </label>
  )
}
