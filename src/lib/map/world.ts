import type { Feature, Geometry } from 'geojson'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'

let worldFeaturesPromise: Promise<Feature<Geometry>[]> | null = null

/**
 * Country polygons for the globe. Fetched from `public/data/` at runtime
 * instead of `import`-ed from `world-atlas` — a static import bakes the
 * ~108KB topology into the main JS chunk, parsed and held in memory before
 * the app can do anything with it. A fetch defers that cost until it's
 * actually needed and lets the browser cache it like any other asset.
 */
export function loadWorldFeatures(): Promise<Feature<Geometry>[]> {
  worldFeaturesPromise ??= fetch(`${import.meta.env.BASE_URL}data/countries-110m.json`)
    .then((res) => res.json() as Promise<Topology>)
    .then((topo) => feature(topo, topo.objects.countries as GeometryCollection<Geometry>).features)
  return worldFeaturesPromise
}
