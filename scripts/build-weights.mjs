#!/usr/bin/env node
// Generates public/data/weights.json from a sparse, hand-chosen set of
// body-angle weights per theme (~8 entries), per ENGINE-SPEC §6.
//
// This replaces an earlier version that built a dense 40-entry-per-theme
// matrix as BASE[body] x ANGLE_EMPHASIS[angle] — an outer product, which is
// rank-1: every body's AC:DC:MC:IC ratio came out identical within a theme
// (Moon-IC/Moon-AC == Venus-IC/Venus-AC == the same fixed ratio for every
// body), which can't express that a body means something different on
// different angles. It also meant every one of the 40 body-angle lines
// contributed *something* everywhere, so a spot where several mediocre
// lines happened to cross could outscore a spot near one genuinely strong,
// well-dignified line — a coincidence of density, not of quality.
//
// Each weight below is chosen independently per body-angle pair, so ratios
// between angles differ per body on purpose. Re-run after editing WEIGHTS:
// node scripts/build-weights.mjs

import { writeFileSync } from 'node:fs'

const SIGMA_KM = 200

const DIGNITY_MULTIPLIER = {
  exalted: 1.3,
  domicile: 1.15,
  peregrine: 1.0,
  detriment: 0.85,
  fall: 0.7,
}

// Sparse per-theme weights. Positive = benefic-for-this-theme signal on that
// line; negative = a malefic influence on the same angle actively working
// against the theme (ENGINE-SPEC §6: "negative weights for malefics... makes
// a clean benefic outscore one sitting next to Pluto"). Absence = no opinion,
// not a weak opinion — it does not contribute at all, unlike a dense matrix
// where every line has some (even if small) say.
const WEIGHTS = {
  love: {
    'Venus-DC': 2.6, // the classic line: where partnership itself forms
    'Venus-AC': 1.6, // attractiveness, ease in your own skin
    'Moon-DC': 1.3, // emotional intimacy with a partner
    'Jupiter-DC': 1.1, // growth and generosity through partnership
    'Venus-IC': 1.0, // domestic affection
    'Saturn-DC': -1.0, // restriction, loneliness in partnership
    'Mars-DC': -0.6, // friction and conflict with a partner
    'Pluto-DC': -0.8, // control, obsession in partnership
  },
  career: {
    'Jupiter-MC': 2.4, // the classic line: opportunity and recognition in public life
    'Saturn-MC': 1.5, // hard-won achievement through discipline
    'Sun-MC': 1.3, // visibility, authority
    'Mercury-MC': 0.9, // communication- and idea-driven career
    'Mars-MC': 0.8, // ambition, competitive drive
    'Jupiter-AC': 0.6, // personal confidence carrying into public life
    'Neptune-MC': -0.7, // confusion, lack of direction in public image
    'Pluto-AC': -0.6, // a public persona that reads as controlling
  },
  harmony: {
    'Moon-IC': 2.5, // the classic line: home, roots, belonging
    'Venus-IC': 1.4, // domestic peace and beauty
    'Jupiter-IC': 1.0, // an abundant, secure home base
    'Moon-AC': 0.9, // an instinctively nurturing, at-ease self
    'Sun-IC': 0.7, // identity rooted in home
    'Saturn-IC': -1.0, // duty or isolation at home
    'Mars-IC': -0.7, // a restless or charged home life
    'Pluto-IC': -0.9, // controlling or obsessive home dynamics
  },
}

const themes = {}
for (const [theme, weights] of Object.entries(WEIGHTS)) {
  themes[theme] = weights
}

writeFileSync('public/data/weights.json', JSON.stringify({ sigmaKm: SIGMA_KM, dignityMultiplier: DIGNITY_MULTIPLIER, themes }, null, 2))
console.log('wrote public/data/weights.json')
