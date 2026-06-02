#!/usr/bin/env node
// spine.js -- freeze the spine: turn the semantically-extracted anchor sentences
// into the frozen spine.json that anchor-diff.js consumes. Deterministic glue:
// the EXTRACTION is a one-time agent step (references/spine.md); this resolves each
// anchor to a stable passage_id via decompose.js, assigns anchor_ids, and writes
// spine.json. The author confirms the anchors BEFORE this runs (the one up-front
// human input auto needs). Dependency-free Node.
//
// CLI:
//   node spine.js freeze <manuscript.tex> [--round N] [--out spine.json]
//        # reads the extracted anchors (JSON array on stdin):
//        #   [ { type, status: "frozen"|"not-yet-written", text|null } , ... ]
//   node spine.js show <spine.json>

'use strict'
const fs = require('fs')
const { decompose } = require('./decompose')

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()

function freeze(extracted, manuscriptTex, round = 0) {
  const passages = decompose(manuscriptTex)
  let n = 0
  const anchors = extracted.map((a) => {
    n++
    const anchor_id = 'A' + n
    if (a.status === 'not-yet-written' || !a.text) {
      return { anchor_id, type: a.type, status: 'not-yet-written', text: null, passage_id: null }
    }
    const na = norm(a.text)
    const p = passages.find((pp) => norm(pp.text).includes(na)) || null
    return {
      anchor_id, type: a.type, status: 'frozen', text: a.text,
      passage_id: p ? p.passage_id : null,
      located: !!p,
    }
  })
  return { frozen_round: round, anchors }
}

function readStdin() {
  const data = fs.readFileSync(0, 'utf8')
  return data && data.trim() ? JSON.parse(data) : []
}

function main() {
  const [cmd, file] = process.argv.slice(2)
  const rest = process.argv.slice(4)
  const flags = {}
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1]; i++ }
  if (cmd === 'freeze') {
    if (!file) { console.error('usage: node spine.js freeze <manuscript.tex> [--round N] [--out spine.json]'); process.exit(2) }
    const extracted = readStdin()
    if (!Array.isArray(extracted)) throw new Error('freeze expects a JSON array of extracted anchors on stdin')
    const spine = freeze(extracted, fs.readFileSync(file, 'utf8'), flags.round ? parseInt(flags.round, 10) : 0)
    const out = flags.out || 'spine.json'
    fs.writeFileSync(out, JSON.stringify(spine, null, 2) + '\n', 'utf8')
    const unlocated = spine.anchors.filter((a) => a.status === 'frozen' && !a.located).map((a) => a.anchor_id)
    console.log(JSON.stringify({ ok: true, out, anchors: spine.anchors.length,
      frozen: spine.anchors.filter((a) => a.status === 'frozen').length,
      not_yet_written: spine.anchors.filter((a) => a.status === 'not-yet-written').length,
      unlocated_warning: unlocated }))
  } else if (cmd === 'show') {
    console.log(JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')), null, 2))
  } else {
    console.error('usage: node spine.js <freeze|show> ...')
    process.exit(2)
  }
}

if (require.main === module) main()

module.exports = { freeze }
