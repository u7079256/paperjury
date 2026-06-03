#!/usr/bin/env node
// journal.js -- append-only, per-edit patch journal for the paperjury.
// Git-independent (so the skill stays generic): every auto-applied edit is logged
// as its own atomic, reversible unit, so on return the author can undo ANY single
// edit without disturbing the others. Decided 2026-05-31 (AUTO_MODE_DESIGN §7).
//
// The Workflow sandbox cannot write files, so the DRAFTER (a workflow agent) only
// PROPOSES {before, after}; the ORCHESTRATOR applies the edit (Edit tool on the
// .tex) and then records it here via `append`. To revert, `revert` prints the
// reverse patch (replace `after` with `before`) for the orchestrator to apply.
//
// Storage: <ledger-dir>/journal.jsonl (one JSON entry per line, append-only).
//
// CLI:
//   node journal.js append <journal.jsonl>            # reads one JSON entry on stdin
//   node journal.js list   <journal.jsonl> [--issue I-05] [--round N]
//   node journal.js get    <journal.jsonl> <J-0001>
//   node journal.js revert <journal.jsonl> <J-0001>   # prints {find, replace, ...} reverse patch
//
// An entry: { seq, jid, issue_id, passage_id, round, close_criterion,
//             before, after, ts, applied }
// `before`/`after` are the exact text the orchestrator used with the Edit tool, so
// the reverse patch (find=after, replace=before) applies cleanly iff the after-text
// is still present (if a later edit moved it, the revert fails loudly -- correct).

'use strict'
const fs = require('fs')
const path = require('path')

function readEntries(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/).filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}

function append(file, entry) {
  const entries = readEntries(file)
  const seq = entries.length + 1
  const full = {
    seq,
    jid: 'J-' + String(seq).padStart(4, '0'),
    issue_id: entry.issue_id ?? null,
    passage_id: entry.passage_id ?? null,
    round: entry.round ?? null,
    close_criterion: entry.close_criterion ?? null,
    before: entry.before ?? '',
    after: entry.after ?? '',
    ts: entry.ts || new Date().toISOString(),
    applied: entry.applied !== false,
  }
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(full) + '\n', 'utf8')
  return full
}

function list(file, { issue, round } = {}) {
  return readEntries(file).filter((e) =>
    (!issue || e.issue_id === issue) && (round == null || e.round === Number(round)))
}

function get(file, jid) {
  const e = readEntries(file).find((x) => x.jid === jid)
  if (!e) throw new Error('no such journal entry: ' + jid)
  return e
}

// The reverse patch the orchestrator applies (Edit: replace `find` with `replace`).
function revertInfo(file, jid) {
  const e = get(file, jid)
  return {
    jid: e.jid, issue_id: e.issue_id, passage_id: e.passage_id,
    find: e.after, replace: e.before,
    note: 'apply as an exact-string Edit on the manuscript; fails if `find` is no longer present (a later edit moved it).',
  }
}

// ---- auto safety-envelope helpers (deterministic; AUTO_MODE_DESIGN §8) ----
// These make the auto drift bounds SCRIPT-checkable instead of model-only. The
// journal already records {passage_id, round, applied} per edit, so the per-passage
// rounds-touched cap and applied-quiescence are pure bookkeeping over it.

// Distinct rounds in which an APPLIED edit touched this passage (the real drift bound).
function roundsTouchedForPassage(file, passageId) {
  const rounds = new Set()
  readEntries(file).forEach((e) => {
    if (e.applied !== false && e.passage_id === passageId && e.round != null) rounds.add(e.round)
  })
  return [...rounds].sort((a, b) => a - b)
}
// The orchestrator queues any further edit to a passage already at the cap (default 2).
function withinPassageCap(file, passageId, cap) {
  return roundsTouchedForPassage(file, passageId).length < (cap == null ? 2 : cap)
}
// Applied edits in a round. Nits/queued items do NOT journal as applied, so they
// never extend the loop; auto stops after K consecutive rounds with 0 applied edits.
function appliedEditsInRound(file, round) {
  return readEntries(file).filter((e) => e.applied !== false && e.round === Number(round)).length
}

// ---- CLI ------------------------------------------------------------------

function parseFlags(argv) {
  const flags = {}, pos = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]; i++ }
    else pos.push(argv[i])
  }
  return { flags, pos }
}

function readStdin() {
  const data = fs.readFileSync(0, 'utf8')
  return data && data.trim() ? JSON.parse(data) : null
}

function main() {
  const [cmd, file, ...rest] = process.argv.slice(2)
  if (!cmd || !file) {
    console.error('usage: node journal.js <append|list|get|revert|passage-rounds|within-cap|applied-in-round> <journal.jsonl> [...]')
    process.exit(2)
  }
  const { flags, pos } = parseFlags(rest)
  if (cmd === 'append') {
    const entry = readStdin()
    if (!entry || typeof entry !== 'object') throw new Error('append expects one JSON entry on stdin')
    const full = append(file, entry)
    console.log(JSON.stringify({ ok: true, jid: full.jid, seq: full.seq }))
  } else if (cmd === 'list') {
    console.log(JSON.stringify(list(file, { issue: flags.issue, round: flags.round }), null, 2))
  } else if (cmd === 'get') {
    console.log(JSON.stringify(get(file, pos[0]), null, 2))
  } else if (cmd === 'revert') {
    console.log(JSON.stringify(revertInfo(file, pos[0]), null, 2))
  } else if (cmd === 'passage-rounds') {
    console.log(JSON.stringify({ passage_id: pos[0], rounds: roundsTouchedForPassage(file, pos[0]) }))
  } else if (cmd === 'within-cap') {
    const cap = flags.cap ? parseInt(flags.cap, 10) : 2
    const ok = withinPassageCap(file, pos[0], cap)
    console.log(JSON.stringify({ passage_id: pos[0], cap, within: ok }))
    process.exit(ok ? 0 : 1)
  } else if (cmd === 'applied-in-round') {
    console.log(JSON.stringify({ round: Number(pos[0]), applied: appliedEditsInRound(file, pos[0]) }))
  } else {
    console.error('unknown command: ' + cmd)
    process.exit(2)
  }
}

if (require.main === module) main()

module.exports = { readEntries, append, list, get, revertInfo, roundsTouchedForPassage, withinPassageCap, appliedEditsInRound }
