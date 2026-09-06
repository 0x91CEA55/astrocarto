import type { Feature, Geometry, MultiLineString } from 'geojson'
import { geoGraticule10, geoPath } from 'd3-geo'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { AngleName, BodyName, LineKey, Lines } from '../lib/astro/types'
import {
  applyRotation,
  clampPitch,
  createGlobeProjection,
  DRAG_DEG_PER_PX,
  dodgeLabels,
  easeCubicInOut,
  FLY_TO_MS,
  flyToTarget,
  isVisible,
  LABEL_MAX_COUNT,
  type Rotation,
} from '../lib/map/globe'
import { BODY_COLOR } from '../lib/map/palette'
import { loadWorldFeatures } from '../lib/map/world'

const graticule = geoGraticule10()
const SPHERE = { type: 'Sphere' as const }
const INITIAL_ROTATION: Rotation = { lambda: 100, phi: -16 }
const REVEAL_DRAW_MS = 1600
const REVEAL_STAGGER_MS = 90

/**
 * Void ground tokens, read from the live stylesheet instead of duplicated as
 * JS constants — same technique poc/reference/*.html uses for planet colors
 * (`getComputedStyle(document.documentElement)`), so App.css stays the one
 * source of truth. Canvas drawing commands don't understand `var(...)`, but
 * they accept any resolved CSS color string directly.
 */
let voidTokensCache: { sea: string; land: string; coast: string; grat: string; limb: string } | null = null
function voidTokens() {
  if (voidTokensCache) return voidTokensCache
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => style.getPropertyValue(name).trim()
  voidTokensCache = { sea: read('--void-sea'), land: read('--void-land'), coast: read('--void-coast'), grat: read('--void-grat'), limb: read('--void-limb') }
  return voidTokensCache
}

export interface GlobeLabel {
  id: string
  lat: number
  lon: number
  name: string
}

export interface GlobeFocus {
  lat: number
  lon: number
  ms?: number
}

interface GlobeProps {
  lines: Lines
  /** Which lines actually draw — the active theme's top contributors, or none pre-reveal. */
  visibleKeys: LineKey[]
  /** The single highest-magnitude contributor at the top place — the heat glow line. */
  leadKey: LineKey | null
  accentColor: string
  labels: GlobeLabel[]
  marker: { lat: number; lon: number } | null
  focus: GlobeFocus | null
  onFocusSettle?: () => void
  drift: boolean
  onInteractionStart?: () => void
  revealing: boolean
  onLabelClick?: (id: string) => void
  /** Glow re-rasterizes every frame and stutters — suspend it while dragging/flying/scrubbing (UX-SPEC §11). */
  suspendBloom?: boolean
  size?: number
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Orthographic globe, rendered to canvas via `geoPath(projection, ctx)`
 * instead of SVG paths — SVG's per-frame DOM diffing over dozens of stroked,
 * filtered paths is the actual cost; canvas draws them as pixels directly.
 * Labels and the birth-place marker stay real positioned DOM elements
 * (absolutely positioned over the canvas, computed from the same
 * projection) so they stay clickable and accessible — only the globe
 * artwork itself (sea, graticule, land, lines, heat, limb) moved to canvas.
 */
export const Globe = forwardRef<HTMLCanvasElement, GlobeProps>(function Globe(
  {
    lines,
    visibleKeys,
    leadKey,
    accentColor,
    labels,
    marker,
    focus,
    onFocusSettle,
    drift,
    onInteractionStart,
    revealing,
    onLabelClick,
    suspendBloom = false,
    size = 620,
  },
  forwardedRef,
) {
  const [rotation, setRotation] = useState<Rotation>(INITIAL_ROTATION)
  const [busy, setBusy] = useState(false)
  const [worldFeatures, setWorldFeatures] = useState<Feature<Geometry>[]>([])
  const rotationRef = useRef(rotation)
  rotationRef.current = rotation
  const dragRef = useRef<{ x: number; y: number; lambda: number; phi: number; moved: boolean; pointerId: number } | null>(null)
  const lastFocusKeyRef = useRef<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useImperativeHandle(forwardedRef, () => canvasRef.current as HTMLCanvasElement, [])

  useEffect(() => {
    loadWorldFeatures().then(setWorldFeatures)
  }, [])

  const projection = useMemo(() => {
    const p = createGlobeProjection(size)
    applyRotation(p, rotation)
    return p
  }, [size, rotation])

  const glowOn = !busy && !revealing && !suspendBloom
  const revealStartRef = useRef<number | null>(null)

  // The actual canvas paint. Not memoized with useCallback — it's redefined
  // every render so it always closes over the latest props/state, and every
  // caller (the layout effect below, plus the drift/flyTo/reveal rAF loops)
  // reaches it through `drawRef.current` rather than a captured reference,
  // so a loop set up several renders ago still paints the current frame.
  function draw() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)

    const path = geoPath(projection, ctx)
    const tokens = voidTokens()

    ctx.beginPath()
    path(SPHERE)
    ctx.fillStyle = tokens.sea
    ctx.fill()

    ctx.beginPath()
    path(graticule)
    ctx.strokeStyle = tokens.grat
    ctx.lineWidth = 0.6
    ctx.stroke()

    for (const f of worldFeatures) {
      ctx.beginPath()
      path(f)
      ctx.fillStyle = tokens.land
      ctx.fill()
      ctx.strokeStyle = tokens.coast
      ctx.lineWidth = 0.45
      ctx.stroke()
    }

    if (leadKey) {
      const [leadBody] = leadKey.split('-') as [BodyName]
      const geometry: MultiLineString = { type: 'MultiLineString', coordinates: (lines[leadKey] ?? []) as [number, number][][] }
      ctx.beginPath()
      path(geometry)
      ctx.strokeStyle = BODY_COLOR[leadBody]
      ctx.lineWidth = 28
      ctx.globalAlpha = 0.4
      ctx.filter = glowOn ? 'blur(10px)' : 'none'
      ctx.stroke()
      ctx.filter = 'none'
      ctx.globalAlpha = 1
    }

    const revealElapsed = revealStartRef.current !== null ? performance.now() - revealStartRef.current : 0
    visibleKeys.forEach((key, i) => {
      const segments = lines[key]
      if (!segments?.length) return
      const [body, angle] = key.split('-') as [BodyName, AngleName]
      const geometry: MultiLineString = { type: 'MultiLineString', coordinates: segments as unknown as [number, number][][] }
      const isAngleLine = angle === 'MC' || angle === 'IC'

      ctx.beginPath()
      path(geometry)
      ctx.strokeStyle = BODY_COLOR[body]
      ctx.lineWidth = 1.7
      ctx.lineCap = 'round'
      ctx.globalAlpha = 0.85

      if (isAngleLine) {
        ctx.setLineDash([6, 5])
      } else if (revealing) {
        const dashBound = size * 3
        const lineProgress = Math.min(1, Math.max(0, (revealElapsed - i * REVEAL_STAGGER_MS) / REVEAL_DRAW_MS))
        ctx.setLineDash([dashBound, dashBound])
        ctx.lineDashOffset = dashBound * (1 - lineProgress)
      } else {
        ctx.setLineDash([])
        ctx.lineDashOffset = 0
      }

      if (glowOn) {
        ctx.shadowColor = BODY_COLOR[body]
        ctx.shadowBlur = 6
      } else {
        ctx.shadowBlur = 0
      }
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    })

    ctx.beginPath()
    path(SPHERE)
    ctx.strokeStyle = tokens.limb
    ctx.lineWidth = 1
    ctx.stroke()

    // Leader lines only — the dot and text are DOM (see the overlay below) so
    // they stay clickable; this is just the connecting stroke when a label
    // has been pushed off its true point by the dodge.
    for (const l of dodged) {
      if (!l.hasLeader) continue
      ctx.beginPath()
      ctx.moveTo(l.x + 5, l.y)
      ctx.lineTo(l.x + 12, l.labelY - 4)
      ctx.strokeStyle = accentColor
      ctx.lineWidth = 0.8
      ctx.globalAlpha = 0.55
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    drawRef.current()
  })

  // Idle drift — ENTRY only, stops permanently the moment the parent says an
  // interaction happened (UX-SPEC §4).
  useEffect(() => {
    if (!drift) return
    let raf: number
    const step = () => {
      if (!dragRef.current) setRotation((r) => ({ ...r, lambda: r.lambda + 0.06 }))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [drift])

  // Reveal draw-on — its own rAF loop since the dash offset must animate even
  // when `rotation` (the layout effect's main trigger) isn't changing frame to frame.
  useEffect(() => {
    if (!revealing) {
      revealStartRef.current = null
      return
    }
    revealStartRef.current = performance.now()
    if (reducedMotion()) {
      drawRef.current()
      return
    }
    let raf: number
    const totalMs = REVEAL_DRAW_MS + visibleKeys.length * REVEAL_STAGGER_MS
    const step = () => {
      drawRef.current()
      if (revealStartRef.current !== null && performance.now() - revealStartRef.current < totalMs) {
        raf = requestAnimationFrame(step)
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealing])

  // Fly-to — triggered whenever `focus` names a new target. 900ms cubic
  // in-out, longitude takes the short way, pitch = lat * 0.6 (UX-SPEC §4).
  useEffect(() => {
    if (!focus) return
    const ms = focus.ms ?? FLY_TO_MS
    const key = `${focus.lat},${focus.lon},${ms}`
    if (lastFocusKeyRef.current === key) return
    lastFocusKeyRef.current = key

    const from = rotationRef.current
    const target = flyToTarget(from, focus.lat, focus.lon)

    if (reducedMotion()) {
      setRotation(target)
      onFocusSettle?.()
      return
    }

    setBusy(true)
    const start = performance.now()
    let raf: number
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const e = easeCubicInOut(k)
      setRotation({ lambda: from.lambda + (target.lambda - from.lambda) * e, phi: from.phi + (target.phi - from.phi) * e })
      if (k < 1) {
        raf = requestAnimationFrame(step)
      } else {
        setBusy(false)
        onFocusSettle?.()
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { x: e.clientX, y: e.clientY, lambda: rotation.lambda, phi: rotation.phi, moved: false, pointerId: e.pointerId }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const dg = dragRef.current
    if (!dg) return
    if (!dg.moved && Math.hypot(e.clientX - dg.x, e.clientY - dg.y) < 4) return
    if (!dg.moved) {
      // Capture only once the drag is real — capturing on pointerdown would
      // retarget the synthesized click to the container and kill label clicks.
      containerRef.current?.setPointerCapture(dg.pointerId)
      onInteractionStart?.()
    }
    dg.moved = true
    setBusy(true)
    setRotation({
      lambda: dg.lambda + (e.clientX - dg.x) * DRAG_DEG_PER_PX,
      phi: clampPitch(dg.phi + (e.clientY - dg.y) * DRAG_DEG_PER_PX),
    })
  }

  useEffect(() => {
    function handlePointerUp() {
      const dg = dragRef.current
      if (!dg) return
      dragRef.current = null
      if (dg.moved) setBusy(false)
    }
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [])

  const dodged = useMemo(() => {
    const points = labels
      .filter((l) => isVisible(l.lat, l.lon, rotation))
      .map((l) => {
        const p = projection([l.lon, l.lat])
        return p ? { id: l.id, x: p[0], y: p[1] } : null
      })
      .filter((p): p is { id: string; x: number; y: number } => p !== null)
      .slice(0, LABEL_MAX_COUNT)
    return dodgeLabels(points)
  }, [labels, rotation, projection])

  const labelByIdName = useMemo(() => new Map(labels.map((l) => [l.id, l.name])), [labels])

  const markerPoint = marker && isVisible(marker.lat, marker.lon, rotation) ? projection([marker.lon, marker.lat]) : null

  return (
    <div
      ref={containerRef}
      className="globe"
      style={{ width: 'min(112vh, 112vw)', aspectRatio: '1', position: 'relative', touchAction: 'none', cursor: dragRef.current?.moved ? 'grabbing' : 'grab' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      role="img"
      aria-label="Orthographic globe with astrocartography lines"
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

      <div className="void-labels-overlay">
        {markerPoint && (
          <div className="void-marker-dom" style={{ left: `${(markerPoint[0] / size) * 100}%`, top: `${(markerPoint[1] / size) * 100}%` }} />
        )}
        {dodged.map((l) => (
          <button
            key={l.id}
            type="button"
            className="void-label-dot"
            style={{ left: `${(l.x / size) * 100}%`, top: `${(l.y / size) * 100}%`, background: accentColor }}
            onClick={() => onLabelClick?.(l.id)}
            aria-label={labelByIdName.get(l.id)}
          />
        ))}
        {dodged.map((l) => (
          <button
            key={l.id}
            type="button"
            className="void-label-text"
            style={{ left: `${((l.x + 14) / size) * 100}%`, top: `${(l.labelY / size) * 100}%` }}
            onClick={() => onLabelClick?.(l.id)}
          >
            {labelByIdName.get(l.id)}
          </button>
        ))}
      </div>
    </div>
  )
})
