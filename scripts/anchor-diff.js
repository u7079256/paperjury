#!/usr/bin/env node
// anchor-diff.js -- the deterministic half of the spine meaning audit.
// Anchor EXTRACTION is a one-time semantic step at spine freeze; this per-round
// DIFF is deterministic (AUTO_MODE_DESIGN §8). For each FROZEN anchor it locates
// the anchor in the current manuscript and reports whether the anchor is still
// present verbatim and whether its SUPPORT region (the paragraph it lives in)
// changed vs a baseline. The semantic meaning-audit agent then only has to judge
// the anchors flagged `need_audit`, never the whole spine -- that is the whole
// point of pre-filtering deterministically.
//
// Anchors are NEVER auto-edited, so `anchor_present_verbatim:false` means a
// non-anchor edit disturbed the anchor sentence itself (a guard violation to
// surface loudly), not a normal edit.
//
// CLI:
//   node anchor-diff.js <spine.json> <current.tex> [baseline.tex]
// Output: JSON { anchors:[ per-anchor diff ], need_audit:[anchor_ids], summary }.
// Provide baseline.tex (normally the frozen round-0 text) so support_changed is
// meaningful; without it, only missing anchors are flagged.

'use strict'
const fs = require('fs')
const { decompose } = require('./decompose')

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()

function passageContaining(passages, anchorText) {
  const a = norm(anchorText)
  if (!a) return null
  return passages.find((p) => norm(p.text).includes(a)) || null
}

function diff(spine, currentTex, baselineTex) {
  const cur = decompose(currentTex)
  const base = baselineTex ? decompose(baselineTex) : null
  const frozen = (spine.anchors || []).filter((x) => x.status === 'frozen' && x.text)
  const anchors = frozen.map((anchor) => {
    const curP = passageContaining(cur, anchor.text)
    const present = !!curP
    let support_changed = false
    let baseP = null
    if (base) {
      // primary lookup is section-agnostic (finds the frozen anchor text anywhere in
      // baseline); the passage_id match and the normalized-text match are last-resort
      // fallbacks, robust to an anchor that moved sections between rounds.
      baseP = passageContaining(base, anchor.text) ||
        (curP && base.find((p) => p.passage_id === curP.passage_id)) ||
        (curP && base.find((p) => norm(p.text) === norm(curP.text))) || null
      support_changed = !baseP || !curP || norm(baseP.text) !== norm(curP.text)
    }
    const need_audit = !present || support_changed
    return {
      anchor_id: anchor.anchor_id,
      type: anchor.type,
      // both names: `anchor_present_verbatim` (canonical) and `present_verbatim`
      // (the field meaning-audit.workflow.js reads), so a direct pipe works either way.
      anchor_present_verbatim: present,
      present_verbatim: present,
      anchor_moved_or_removed: !present,
      support_changed,
      need_audit,
      reason: !present ? 'anchor-not-present-verbatim (guard violation: anchors are never auto-edited)'
        : (support_changed ? 'support-region-changed' : 'unchanged'),
      current_support_passage_id: curP ? curP.passage_id : null,
      current_support_text: curP ? curP.text : null,
      baseline_support_text: baseP ? baseP.text : null,
    }
  })
  const need = anchors.filter((a) => a.need_audit).map((a) => a.anchor_id)
  return {
    anchors,
    need_audit: need,
    summary: {
      frozen: frozen.length,
      not_present: anchors.filter((a) => !a.anchor_present_verbatim).length,
      support_changed: anchors.filter((a) => a.support_changed).length,
      need_audit: need.length,
      baseline_used: !!base,
    },
  }
}

function main() {
  const [spineFile, curFile, baseFile] = process.argv.slice(2)
  if (!spineFile || !curFile) {
    console.error('usage: node anchor-diff.js <spine.json> <current.tex> [baseline.tex]')
    process.exit(2)
  }
  const spine = JSON.parse(fs.readFileSync(spineFile, 'utf8'))
  const currentTex = fs.readFileSync(curFile, 'utf8')
  const baselineTex = baseFile ? fs.readFileSync(baseFile, 'utf8') : null
  console.log(JSON.stringify(diff(spine, currentTex, baselineTex), null, 2))
}

if (require.main === module) main()

module.exports = { diff, norm, passageContaining }
