import { useEffect, useRef, useState, type RefObject } from 'react'
import type { BookDetails } from './bookModel'
import type { ParcelScene } from './parcelScene'

export interface ParcelSceneState {
  scene: RefObject<ParcelScene | null>
  ready: boolean
  /** True when this computer cannot show 3D, so the page shows a flat cover instead. */
  failed: boolean
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Starts the 3D stage in a canvas. Three.js loads only when a parcel is on screen. */
export function useParcelScene(
  canvas: RefObject<HTMLCanvasElement | null>,
  details: BookDetails | null,
  wrapped: boolean
): ParcelSceneState {
  const scene = useRef<ParcelScene | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!details || !canvas.current) return
    let cancelled = false
    const target = canvas.current
    void (async () => {
      try {
        const { ParcelScene: Stage } = await import('./parcelScene')
        if (cancelled) return
        const created = new Stage(target, prefersReducedMotion())
        scene.current = created
        await created.load(details, wrapped)
        if (!cancelled) setReady(true)
      } catch (error) {
        console.error('The 3D parcel could not start.', error)
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      scene.current?.dispose()
      scene.current = null
    }
    // A book is staged once. Its details do not change while it is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details === null])

  return { scene, ready, failed }
}
