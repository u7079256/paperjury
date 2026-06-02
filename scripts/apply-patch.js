#!/usr/bin/env node
// apply-patch.js -- deterministic apply + journal of a drafted patch, and its
// revert. This shrinks the D5 "model-driven orchestration glue" surface: applying
// an edit and recording it for revert is now an atomic, testable script, not a
// hand-made Edit the orchestrator might get wrong. The drafter (a workflow agent)
// only PROPOSES {before, after}; THIS applies it under the gates.
//
// SAFETY: only invoke under the authorization gates (review: per-edit sign-off;
// auto: the bounded-aggressive policy after up-front spine+policy sign-off). The
// `before` text must appear EXACTLY ONCE in the manuscript: 0 -> not-found (re-draft
// against current text), >1 -> ambiguous (re-draft with more surrounding context).
// This exact-once rule is itself a guard against blind edits.
//
// CLI:
//   node apply-patch.js apply  <manuscript.tex> <journal.jsonl>   # patch JSON on stdin:
//        { issue_id, passage_id, before, after, close_criterion, round }
//   node apply-patch.js revert <manuscript.tex> <journal.jsonl> <J-0001>
// apply  -> { ok, jid } or { ok:false, reason }
// revert -> { ok } or { ok:false, reason }; logs a revert marker entry in the journal.

'use strict'
const fs = require('fs')
const journal = require('./journal')

function countOccurrences(hay, needle) {
  if (!needle) return 0
  let n = 0, i = 0
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length }
  return n
}

function apply(texFile, journalFile, patch) {
  const tex = fs.readFileSync(texFile, 'utf8')
  if (!patch.before || patch.before === patch.after) {
    return { ok: false, reason: 'no-op or empty before (needs-human / nothing to apply)' }
  }
  const occ = countOccurrences(tex, patch.before)
  if (occ === 0) return { ok: false, reason: 'before-not-found (re-draft against current text)' }
  if (occ > 1) return { ok: false, reason: `before-ambiguous (${occ} matches; re-draft with more surrounding context)` }
  const next = tex.replace(patch.before, patch.after)
  fs.writeFileSync(texFile, next, 'utf8')
  const entry = journal.append(journalFile, {
    issue_id: patch.issue_id, passage_id: patch.passage_id,
    round: patch.round, close_criterion: patch.close_criterion,
    before: patch.before, after: patch.after, applied: true,
  })
  return { ok: true, jid: entry.jid }
}

function revert(texFile, journalFile, jid) {
  const tex = fs.readFileSync(texFile, 'utf8')
  const info = journal.revertInfo(journalFile, jid) // { find: after, replace: before }
  const occ = countOccurrences(tex, info.find)
  if (occ === 0) return { ok: false, reason: 'after-text not present (a later edit moved it; revert manually)' }
  if (occ > 1) return { ok: false, reason: `after-text ambiguous (${occ} matches)` }
  fs.writeFileSync(texFile, tex.replace(info.find, info.replace), 'utf8')
  journal.append(journalFile, {
    issue_id: info.issue_id, passage_id: info.passage_id,
    before: info.find, after: info.replace, applied: false,
    close_criterion: `REVERT of ${jid}`,
  })
  return { ok: true, reverted: jid }
}

function readStdin() {
  const d = fs.readFileSync(0, 'utf8')
  return d && d.trim() ? JSON.parse(d) : null
}

function main() {
  const [cmd, texFile, journalFile, jid] = process.argv.slice(2)
  if (!cmd || !texFile || !journalFile) {
    console.error('usage: node apply-patch.js <apply|revert> <manuscript.tex> <journal.jsonl> [J-id]')
    process.exit(2)
  }
  let res
  if (cmd === 'apply') {
    const patch = readStdin()
    if (!patch) throw new Error('apply expects a patch JSON on stdin')
    res = apply(texFile, journalFile, patch)
  } else if (cmd === 'revert') {
    if (!jid) throw new Error('revert needs a journal id')
    res = revert(texFile, journalFile, jid)
  } else { console.error('unknown command: ' + cmd); process.exit(2) }
  console.log(JSON.stringify(res))
  process.exit(res.ok ? 0 : 1)
}

if (require.main === module) main()

module.exports = { apply, revert, countOccurrences }
