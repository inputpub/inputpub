import { useEffect, useState } from 'react'
import { isMediaPath } from '../vault'
import { vaultFileObjectUrl } from '../lib/vaultImages'

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogg)$/i

/** Read-only view of a vault file the editor can't edit. Images and video are
 *  shown; anything else just says so — which is still worth listing for, since
 *  a file you can't see is one you can't delete or even know is there.
 *
 *  Bytes are fetched with the vault's credentials and shown from an object URL
 *  (revoked centrally in lib/vaultImages, since the same blob may back an <img>
 *  in the editor). */
export function FilePreview({ path }: { path: string }) {
  const media = isMediaPath(path)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // No state reset here: the caller keys this component by path, so a different
  // file arrives as a fresh mount rather than a stale one being cleared.
  useEffect(() => {
    // Nothing to fetch for a format we couldn't render anyway — and it could be
    // huge.
    if (!media) return
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
  }, [path, media])

  if (!media) {
    const ext = /\.([^./]+)$/.exec(path)?.[1]
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
        <p className="m-0 text-[0.9rem]">
          {ext ? `Can’t preview .${ext.toLowerCase()} files` : 'Can’t preview this file'}
        </p>
        <p className="m-0 text-[0.8rem] text-muted">
          It’s in your repo — this editor just can’t open it.
        </p>
      </div>
    )
  }

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
