#!/usr/bin/env node
// Converts a GeoNames cities15000.txt dump into the compact array-of-tuples
// JSON the app fetches at runtime (public/data/cities.json).
//
// Source: https://download.geonames.org/export/dump/cities15000.zip (CC-BY 4.0)
// Refresh with: node scripts/build-gazetteer.mjs <path-to-cities15000.txt> public/data/cities.json

import { readFileSync, writeFileSync } from 'node:fs'

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('usage: build-gazetteer.mjs <cities15000.txt> <out.json>')
  process.exit(1)
}

const raw = readFileSync(inPath, 'utf8')
const rows = []

for (const line of raw.split('\n')) {
  if (!line) continue
  const cols = line.split('\t')
  const [, name, asciiname, , lat, lon, , , countryCode, , , , , , population, , , timezone] = cols
  rows.push([
    name,
    asciiname !== name ? asciiname : null,
    Math.round(Number(lat) * 10_000) / 10_000,
    Math.round(Number(lon) * 10_000) / 10_000,
    countryCode,
    Number(population) || 0,
    timezone,
  ])
}

// Largest cities first so truncated/ranked autocomplete results default to relevance.
rows.sort((a, b) => b[5] - a[5])

writeFileSync(outPath, JSON.stringify(rows))
console.log(`wrote ${rows.length} cities to ${outPath}`)
