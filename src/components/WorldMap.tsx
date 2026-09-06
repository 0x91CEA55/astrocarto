import type { MultiLineString } from 'geojson'
import { useMemo } from 'react'
import { geoEquirectangular, geoGraticule10, geoPath } from 'd3-geo'
import { loadWorldFeatures } from '../lib/map/world'
import { BODY_COLOR } from '../lib/map/palette'
import type { RasterCell } from '../lib/scoring/score'
import type { AngleName, BodyName, LineKey, LineSegment, Lines } from '../lib/astro/types'

const worldFeatures = loadWorldFeatures()

interface WorldMapProps {
  lines: Lines
  visibleBodies: ReadonlySet<BodyName>
  raster?: RasterCell[]
  width?: number
  height?: number
}

export function WorldMap({ lines, visibleBodies, raster, width = 960, height = 480 }: WorldMapProps) {
  const projection = useMemo(
    () =>
      geoEquirectangular().fitExtent(
        [
          [4, 4],
          [width - 4, height - 4],
        ],
        { type: 'Sphere' },
      ),
    [width, height],
  )
  const path = useMemo(() => geoPath(projection), [projection])
  const graticule = useMemo(() => geoGraticule10(), [])

  const maxScore = useMemo(() => Math.max(1e-6, ...(raster ?? []).map((c) => c.score)), [raster])

  const cellSizePx = useMemo(() => {
    if (!raster?.length) return { w: 0, h: 0 }
    const stepDeg = Math.abs(raster[1].lon - raster[0].lon) || 2
    const origin = projection([0, 0])
    const corner = projection([stepDeg, -stepDeg])
    if (!origin || !corner) return { w: 0, h: 0 }
    return { w: Math.abs(corner[0] - origin[0]), h: Math.abs(corner[1] - origin[1]) }
  }, [raster, projection])

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="World map with astrocartography lines">
      <path d={path({ type: 'Sphere' }) ?? undefined} className="sphere" />
      <path d={path(graticule) ?? undefined} className="graticule" />
      {worldFeatures.features.map((f, i) => (
        <path key={i} d={path(f) ?? undefined} className="country" />
      ))}

      {raster?.map((cell, i) => {
        if (cell.score <= 0) return null
        const pos = projection([cell.lon, cell.lat])
        if (!pos) return null
        const opacity = Math.min(0.65, (cell.score / maxScore) * 0.65)
        return (
          <rect
            key={i}
            x={pos[0] - cellSizePx.w / 2}
            y={pos[1] - cellSizePx.h / 2}
            width={cellSizePx.w}
            height={cellSizePx.h}
            fill="#ff5fa2"
            opacity={opacity}
          />
        )
      })}

      {(Object.entries(lines) as Array<[LineKey, LineSegment[]]>).map(([key, segments]) => {
        const [body, angle] = key.split('-') as [BodyName, AngleName]
        if (!visibleBodies.has(body) || segments.length === 0) return null
        const geometry: MultiLineString = {
          type: 'MultiLineString',
          coordinates: segments.map((seg) => seg.map(([lon, lat]) => [lon, lat])),
        }
        return (
          <path
            key={key}
            d={path(geometry) ?? undefined}
            fill="none"
            stroke={BODY_COLOR[body]}
            strokeWidth={1.6}
            strokeDasharray={angle === 'MC' || angle === 'IC' ? '4 3' : undefined}
            opacity={0.9}
          />
        )
      })}
    </svg>
  )
}
