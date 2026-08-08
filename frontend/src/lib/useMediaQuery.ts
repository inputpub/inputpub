import { useEffect, useState } from 'react'

/** Subscribe to a CSS media query from JS. For the cases where a layout
 *  decision expressed in CSS also has to drive behaviour — see
 *  SIDEBAR_OVERLAY_QUERY, where the sidebar only acts like a drawer at the
 *  width its stylesheet turns it into one. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const sync = () => setMatches(mql.matches)
    sync() // the query may have changed between render and effect
    mql.addEventListener('change', sync)
    return () => mql.removeEventListener('change', sync)
  }, [query])
  return matches
}
