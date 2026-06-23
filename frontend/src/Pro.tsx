import './Pro.css'

/** Standalone, minimalist pricing page for Input Pub Pro.
 *  Reached at /pro (see main.tsx); plain anchor links navigate, so it works
 *  as a full page load on GitHub Pages via the 404.html SPA fallback. */
function Pro() {
  return (
    <div className="pro">
      <a className="pro-back" href="/">
        ← Back to editor
      </a>

      <main className="pro-card">
        <h1 className="pro-title">Input Pub Pro</h1>
        <p className="pro-tagline">Everything in the free editor, plus a little more.</p>

        <div className="pro-price">
          <span className="pro-amount">$5</span>
          <span className="pro-period">/ month</span>
        </div>

        <ul className="pro-features">
          <li>
            <span className="pro-feature-name">Image uploads</span>
            <span className="pro-feature-desc">
              Drop images straight into a note; we host them and insert the link for you.
            </span>
          </li>
          <li>
            <span className="pro-feature-name">Cloud drafts</span>
            <span className="pro-feature-desc">
              Store drafts in the cloud — pick up where you left off on any device.
            </span>
          </li>
        </ul>

        <a className="pro-cta" href="mailto:timqian92@gmail.com?subject=Input%20Pub%20Pro">
          Get Pro
        </a>
        <p className="pro-note">Cancel anytime. The free editor stays free.</p>
      </main>
    </div>
  )
}

export default Pro
