#!/usr/bin/env node
// Resolves GeoNames -> Wikidata QID -> English Wikipedia article title, at
// build time, into the gazetteer's existing tuple (public/data/cities.json).
// See poc/UX-SPEC.md §7: "Do not match by name at runtime" — fuzzy
// GeoNames-name -> Wikipedia-title matching returns confidently wrong
// articles ("Kingston" is Jamaica, Ontario, New York, upon-Thames). Resolving
// via wdt:P1566 (the GeoNames-ID Wikidata property) at build time makes the
// runtime lookup exact.
//
// Run after build-gazetteer.mjs (which writes geonameId + a null wikiTitle
// into every row): node scripts/resolve-wikidata.mjs public/data/cities.json
//
// Idempotent / resumable: writes the full output after every batch and keeps
// a checkpoint (byte-identical shape to the output) alongside it, so a
// crash/interrupt loses at most one batch. Re-run with the same args to
// resume from the checkpoint.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const [, , path] = process.argv
if (!path) {
  console.error('usage: resolve-wikidata.mjs <cities.json>')
  process.exit(1)
}

const BATCH_SIZE = 250
const BATCH_DELAY_MS = 500
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'astrocarto-gazetteer-builder/1.0 (build-time script, no runtime traffic; https://github.com/0x91CEA55/astrocarto)'
const checkpointPath = `${path}.wikidata-checkpoint`

// Tuple shape (see scripts/build-gazetteer.mjs and src/lib/gazetteer/cities.ts):
// [name, ascii, lat, lon, countryCode, population, tz, geonameId, wikiTitle]
const GEONAME_ID_IDX = 7
const WIKI_TITLE_IDX = 8

const rows = JSON.parse(readFileSync(existsSync(checkpointPath) ? checkpointPath : path, 'utf8'))

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function resolveBatch(geonameIds, attempt = 1) {
  const values = geonameIds.map((id) => `"${id}"`).join(' ')
  const query = `
    SELECT ?gid ?title WHERE {
      VALUES ?gid { ${values} }
      ?item wdt:P1566 ?gid .
      OPTIONAL {
        ?article schema:about ?item ;
                 schema:isPartOf <https://en.wikipedia.org/> ;
                 schema:name ?title .
      }
    }
  `

  const res = await fetch(SPARQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/sparql-results+json',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ query }),
  })

  if (res.status === 429 || res.status === 503) {
    if (attempt > 5) throw new Error(`SPARQL endpoint still ${res.status} after ${attempt} attempts`)
    const backoffMs = 2000 * attempt
    console.warn(`  ${res.status}, backing off ${backoffMs}ms (attempt ${attempt})`)
    await sleep(backoffMs)
    return resolveBatch(geonameIds, attempt + 1)
  }
  if (!res.ok) throw new Error(`SPARQL query failed: ${res.status} ${await res.text()}`)

  const json = await res.json()
  // Map geonameId -> title. A gid can appear once with no title (item exists,
  // no enwiki sitelink) — leave it null rather than treating it as unresolved.
  const titleByGid = new Map()
  for (const binding of json.results.bindings) {
    const gid = binding.gid.value
    const title = binding.title?.value ?? null
    if (title && !titleByGid.has(gid)) titleByGid.set(gid, title)
    else if (!titleByGid.has(gid)) titleByGid.set(gid, null)
  }
  return titleByGid
}

async function main() {
  const startIndex = existsSync(checkpointPath) ? rows.findIndex((r) => r[WIKI_TITLE_IDX] === undefined) : 0
  const fromIndex = startIndex === -1 ? rows.length : startIndex
  if (existsSync(checkpointPath)) {
    console.log(`resuming from checkpoint at row ${fromIndex}/${rows.length}`)
  }

  // Sentinel: mark every row `undefined` (not yet attempted) up front so a
  // resume can tell "not tried" apart from "tried, no match" (null).
  for (let i = fromIndex; i < rows.length; i++) rows[i][WIKI_TITLE_IDX] = undefined

  let resolvedCount = 0
  for (let i = fromIndex; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const geonameIds = batch.map((r) => r[GEONAME_ID_IDX])
    const titleByGid = await resolveBatch(geonameIds)

    for (const row of batch) {
      const title = titleByGid.get(String(row[GEONAME_ID_IDX])) ?? null
      row[WIKI_TITLE_IDX] = title
      if (title) resolvedCount++
    }

    const done = Math.min(i + BATCH_SIZE, rows.length)
    console.log(`resolved ${done}/${rows.length} rows (${resolvedCount} with a wikiTitle so far)`)
    writeFileSync(checkpointPath, JSON.stringify(rows))

    if (done < rows.length) await sleep(BATCH_DELAY_MS)
  }

  writeFileSync(path, JSON.stringify(rows))
  console.log(`wrote ${rows.length} rows to ${path} (${resolvedCount} resolved to a Wikipedia title)`)
}

main().catch((err) => {
  console.error(err)
  console.error(`progress saved to ${checkpointPath} -- re-run the same command to resume`)
  process.exit(1)
})
