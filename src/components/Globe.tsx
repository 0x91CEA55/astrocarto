import type { MultiLineString } from 'geojson'
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

const worldFeatures = loadWorldFeatures()
const graticule = geoGraticule10()
const INITIAL_ROTATION: Rotation = { lambda: 100, phi: -16 }

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
  size?: number
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const Globe = forwardRef<SVGSVGElement, GlobeProps>(function Globe(
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
    size = 620,
  },
  forwardedRef,
) {
  const [rotation, setRotation] = useState<Rotation>(INITIAL_ROTATION)
  const [busy, setBusy] = useState(false)
  const rotationRef = useRef(rotation)
  rotationRef.current = rotation
  const dragRef = useRef<{ x: number; y: number; lambda: number; phi: number; moved: boolean; pointerId: number } | null>(null)
  const lastFocusKeyRef = useRef<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  useImperativeHandle(forwardedRef, () => svgRef.current as SVGSVGElement, [])

  const projection = useMemo(() => {
    const p = createGlobeProjection(size)
    applyRotation(p, rotation)
    return p
  }, [size, rotation])
  const path = useMemo(() => geoPath(projection), [projection])

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

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    dragRef.current = { x: e.clientX, y: e.clientY, lambda: rotation.lambda, phi: rotation.phi, moved: false, pointerId: e.pointerId }
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const dg = dragRef.current
    if (!dg) return
    if (!dg.moved && Math.hypot(e.clientX - dg.x, e.clientY - dg.y) < 4) return
    if (!dg.moved) {
      // Capture only once the drag is real — capturing on pointerdown would
      // retarget the synthesized click to the SVG root and kill label clicks.
      svgRef.current?.setPointerCapture(dg.pointerId)
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

  const dashBound = size * 3
  const bloomOn = !busy && !revealing
  const filterAttr = bloomOn ? 'url(#bloom)' : undefined

  return (
    <svg
      ref={svgRef}
      className="globe"
      viewBox={`0 0 ${size} ${size}`}
      style={{ touchAction: 'none', cursor: dragRef.current?.moved ? 'grabbing' : 'grab' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      role="img"
      aria-label="Orthographic globe with astrocartography lines"
    >
      <defs>
        <filter id="bloom" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="heatBlur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="13" />
        </filter>
      </defs>

      <path d={path({ type: 'Sphere' }) ?? undefined} className="void-sea" />
      <path d={path(graticule) ?? undefined} className="void-grat" />
      {worldFeatures.features.map((f, i) => (
        <path key={i} d={path(f) ?? undefined} className="void-land" />
      ))}

      {leadKey &&
        (() => {
          const [leadBody] = leadKey.split('-') as [BodyName]
          const geometry: MultiLineString = { type: 'MultiLineString', coordinates: (lines[leadKey] ?? []) as [number, number][][] }
          const d = path(geometry)
          if (!d) return null
          return <path d={d} className="void-heat" stroke={BODY_COLOR[leadBody]} filter="url(#heatBlur)" />
        })()}

      <g>
        {visibleKeys.map((key, i) => {
          const segments = lines[key]
          if (!segments?.length) return null
          const [body, angle] = key.split('-') as [BodyName, AngleName]
          const geometry: MultiLineString = { type: 'MultiLineString', coordinates: segments as unknown as [number, number][][] }
          const d = path(geometry)
          if (!d) return null
          return (
            <path
              key={key}
              d={d}
              className={revealing ? 'void-line reveal' : 'void-line'}
              stroke={BODY_COLOR[body]}
              // MC/IC keep their dashed identity even during the reveal — combining that
              // with the draw-on dashoffset trick would need a second, longer dash run,
              // not worth the complexity for a 1.6s one-time effect. They simply appear.
              strokeDasharray={angle === 'MC' || angle === 'IC' ? '6 5' : revealing ? dashBound : undefined}
              strokeDashoffset={revealing && angle !== 'MC' && angle !== 'IC' ? dashBound : undefined}
              style={revealing ? { animationDelay: `${i * 90}ms` } : undefined}
              filter={filterAttr}
            />
          )
        })}
      </g>

      <path d={path({ type: 'Sphere' }) ?? undefined} className="void-limb" />

      {markerPoint && <circle cx={markerPoint[0]} cy={markerPoint[1]} r={4} className="void-marker" />}

      <g className="void-labels">
        {dodged.map((l) => (
          <g key={l.id} onClick={() => onLabelClick?.(l.id)} className="void-label-group">
            <circle cx={l.x} cy={l.y} r={4.5} fill={accentColor} />
            {l.hasLeader && <line x1={l.x + 5} y1={l.y} x2={l.x + 12} y2={l.labelY - 4} stroke={accentColor} strokeWidth={0.8} opacity={0.55} />}
            <text x={l.x + 14} y={l.labelY}>
              {labelByIdName.get(l.id)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
})
