// Theme preference: 'system' follows the OS via the prefers-color-scheme media
// query (the CSS in index.css / editor-theme.css handles that case with no
// attribute set); 'light'/'dark' force a scheme via a data-theme attribute on
// <html>, which those same stylesheets read to override the media query.

export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'theme'

// The two <meta name="theme-color"> tags in index.html are keyed on
// prefers-color-scheme, which is only the right answer while the preference is
// 'system'. Pin a theme against the OS's opposite one and the browser would
// still read the tag matching the OS — which is how the iOS status bar stayed
// light in an app showing dark. So: leave them alone for 'system' (the browser
// handles an OS switch better than we can), and override both with the colour
// actually in force otherwise. Captured up front, since the override destroys
// the originals.
const themeColorMetas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
const themeColorDefaults = themeColorMetas.map((meta) => meta.content)

function syncThemeColor(pref: ThemePref): void {
  if (pref === 'system') {
    themeColorMetas.forEach((meta, i) => (meta.content = themeColorDefaults[i]))
    return
  }
  // Read it back off the document rather than repeating the palette here: the
  // data-theme attribute is already set, so this is exactly the backdrop the
  // page is painting, and it stays right if that colour ever changes.
  const resolved = getComputedStyle(document.documentElement).backgroundColor
  for (const meta of themeColorMetas) meta.content = resolved
}

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

/** Apply a preference to the document (and persist it). Call before first paint
 *  to avoid a flash, and again whenever the user changes it. */
export function applyThemePref(pref: ThemePref): void {
  const root = document.documentElement
  if (pref === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', pref)
  syncThemeColor(pref)
  localStorage.setItem(KEY, pref)
}

/** Next preference in the System → Light → Dark cycle. */
export function nextThemePref(pref: ThemePref): ThemePref {
  return pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system'
}
