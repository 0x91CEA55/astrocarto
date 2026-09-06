import type { Geometry } from 'geojson'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import worldTopo from 'world-atlas/countries-110m.json'

/** Country polygons for the base map, decoded once from the bundled topology. */
export function loadWorldFeatures() {
  const topo = worldTopo as unknown as Topology
  return feature(topo, topo.objects.countries as GeometryCollection<Geometry>)
}
