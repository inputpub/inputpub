import './Template.css'

/** One row in the variables / filters tables. */
interface Row {
  name: string
  desc: string
}

const VARIABLES: Row[] = [
  { name: 'title', desc: 'The note’s title — its first heading, or the first non-empty line.' },
  { name: 'body', desc: 'The full note, as raw Markdown. Untouched unless you pipe a filter.' },
  { name: 'date', desc: 'Today’s date, like 2026-06-30 (your local day).' },
  { name: 'datetime', desc: 'The current time as an ISO 8601 timestamp, like 2026-06-30T08:00:00.000Z.' },
  {
    name: 'filename',
    desc: 'The filename you type at publish time. Only some targets ask for one (e.g. GitHub).',
  },
]

const FILTERS: Row[] = [
  {
    name: 'plain',
    desc: 'Markdown → readable plain text. Strips styling markers but keeps text, line breaks, and link URLs. For targets that don’t render Markdown (X, email).',
  },
  {
    name: 'mp-html',
    desc: 'Markdown → HTML tailored for WeChat’s 公众号 editor: inline styles (so it pastes already formatted), outbound links turned into numbered footnotes, and images kept as URLs that the editor re-hosts on paste.',
  },
  { name: 'no-title', desc: 'Drops the first “# ” heading, so the title isn’t repeated in the body.' },
  { name: 'no-images', desc: 'Removes ![alt](url) image syntax, leaving the surrounding text.' },
  { name: 'quote', desc: 'Wraps the value in double quotes and escapes it — handy for YAML front matter.' },
]

const EXAMPLES: { template: string; desc: string }[] = [
  { template: '{{ body }}', desc: 'The note as-is. The default for most targets.' },
  { template: '{{ body | mp-html }}', desc: 'Formatted content for WeChat’s 公众号 editor.' },
  { template: '{{ body | plain }}', desc: 'Plain text — used for X and email bodies.' },
  { template: '{{ body | no-title }}', desc: 'The body with its leading heading removed.' },
  {
    template: '{{ body | no-title | no-images }}',
    desc: 'Filters chain left to right: drop the heading, then strip images.',
  },
  {
    template: '---\ntitle: {{ title | quote }}\ndate: {{ date }}\n---\n\n{{ body | no-title }}',
    desc: 'A whole layout — YAML front matter plus the body, for a GitHub post.',
  },
]

/** Standalone reference for the little template language used by destination
 *  content fields. Reached at /template (see main.tsx); works as a full page
 *  load on GitHub Pages via the 404.html SPA fallback. */
function Template() {
  return (
    <div className="tpl">
      <div className="tpl-wrap">
        <a className="tpl-back" href="/">
          ← Back to editor
        </a>

        <main className="tpl-card">
          <h1 className="tpl-title">Template syntax</h1>
          <p className="tpl-tagline">
            Each destination has a content template that shapes your note before it’s published.
            Write any text, and drop in <code>{'{{ … }}'}</code> placeholders for the note’s parts.
          </p>

          <section className="tpl-section">
            <h2 className="tpl-h2">How it works</h2>
            <p className="tpl-p">
              A placeholder is a <strong>variable</strong>, optionally piped through one or more{' '}
              <strong>filters</strong>:
            </p>
            <pre className="tpl-code">{'{{ source | filter | filter }}'}</pre>
            <ul className="tpl-list">
              <li>Filters run left to right — each transforms the previous result.</li>
              <li>Whitespace inside the braces doesn’t matter.</li>
              <li>An unknown variable renders empty; an unknown filter is ignored.</li>
              <li>Leave a template empty to fall back to that target’s default.</li>
            </ul>
          </section>

          <section className="tpl-section">
            <h2 className="tpl-h2">Variables</h2>
            <table className="tpl-table">
              <tbody>
                {VARIABLES.map((v) => (
                  <tr key={v.name}>
                    <td>
                      <code>{`{{${v.name}}}`}</code>
                    </td>
                    <td>{v.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="tpl-section">
            <h2 className="tpl-h2">Filters</h2>
            <table className="tpl-table">
              <tbody>
                {FILTERS.map((f) => (
                  <tr key={f.name}>
                    <td>
                      <code>| {f.name}</code>
                    </td>
                    <td>{f.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="tpl-section">
            <h2 className="tpl-h2">Examples</h2>
            <div className="tpl-examples">
              {EXAMPLES.map((e) => (
                <div className="tpl-example" key={e.template}>
                  <pre className="tpl-code">{e.template}</pre>
                  <p className="tpl-example-desc">{e.desc}</p>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

export default Template
