#!/usr/bin/env node
// Generates public/data/weights.json from an explicit base(body) x angle-emphasis(theme)
// model, so the 120 theme/body/angle numbers stay auditable instead of hand-typed.
// Re-run after editing BASE or ANGLE_EMPHASIS below: node scripts/build-weights.mjs

import { writeFileSync } from 'node:fs'

const SIGMA_KM = 200

const DIGNITY_MULTIPLIER = {
  exalted: 1.3,
  domicile: 1.15,
  peregrine: 1.0,
  detriment: 0.85,
  fall: 0.7,
}

// Base affinity of each body for a theme, independent of which angle it's on.
const BASE = {
  love: { Sun: 0.6, Moon: 1.3, Mercury: 0.5, Venus: 2.0, Mars: 0.4, Jupiter: 1.1, Saturn: -0.8, Uranus: -0.6, Neptune: 0.9, Pluto: -0.5 },
  career: { Sun: 1.4, Moon: -0.3, Mercury: 1.0, Venus: 0.7, Mars: 1.2, Jupiter: 1.5, Saturn: 1.3, Uranus: 0.5, Neptune: -0.7, Pluto: 1.0 },
  harmony: { Sun: 0.8, Moon: 1.5, Mercury: 0.6, Venus: 1.6, Mars: -1.0, Jupiter: 1.3, Saturn: -1.1, Uranus: -0.9, Neptune: 1.2, Pluto: -1.3 },
}

// How much each theme cares about AC (self) / DC (partners) / MC (public) / IC (home).
const ANGLE_EMPHASIS = {
  love: { AC: 0.9, DC: 1.3, MC: 0.4, IC: 0.8 },
  career: { AC: 0.9, DC: 0.5, MC: 1.4, IC: 0.4 },
  harmony: { AC: 0.9, DC: 0.7, MC: 0.3, IC: 1.3 },
}

const ANGLES = ['AC', 'DC', 'MC', 'IC']

const themes = {}
for (const theme of Object.keys(BASE)) {
  const weights = {}
  for (const [body, base] of Object.entries(BASE[theme])) {
    for (const angle of ANGLES) {
      weights[`${body}-${angle}`] = Math.round(base * ANGLE_EMPHASIS[theme][angle] * 100) / 100
    }
  }
  themes[theme] = weights
}

writeFileSync('public/data/weights.json', JSON.stringify({ sigmaKm: SIGMA_KM, dignityMultiplier: DIGNITY_MULTIPLIER, themes }, null, 2))
console.log('wrote public/data/weights.json')
