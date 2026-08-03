import { useEffect, useState } from 'react'
import { vaultFileObjectUrl } from '../lib/vaultImages'

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogg)$/i

/** Read-only view of a non-text vault file. Images and video can't be edited
 *  here, but they can be looked at and deleted, which is the point of listing
 *  them at all — an image pasted into a note and later orphaned would otherwise
 *  be invisible from inside the app.
 *
 *  Bytes are fetched with the vault's credentials and shown from an object URL
 *  (revoked centrally in lib/vaultImages, since the same blob may back an <img>
 *  in the editor). */
export function MediaPreview({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // No state reset here: the caller keys this component by path, so a different
  // file arrives as a fresh mount rather than a stale one being cleared.
  useEffect(() => {
    let cancelled = false
    vaultFileObjectUrl(path)
      .then((u) => {
        if (!cancelled) setUrl(u)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (error) {
    return <p className="m-0 text-[0.85rem] text-[#e5484d]">{error}</p>
  }
  if (!url) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <svg
          className="size-5 animate-spin opacity-40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
    )
  }

  return (
    <div className="flex flex-1 items-start justify-center">
      {VIDEO_EXT.test(path) ? (
        <video className="max-h-full max-w-full" src={url} controls />
      ) : (
        <img className="max-h-full max-w-full object-contain" src={url} alt={path} />
      )}
    </div>
  )
}
