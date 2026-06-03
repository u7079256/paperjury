#!/usr/bin/env node
// ledger.js -- the paperjury ledger: JSON source of truth + rendered
// Markdown view (decided 2026-06-01, D1). Dependency-free Node. Works as a
// require() module AND as a Bash-callable CLI, because the deterministic guards
// run orchestrator-side between workflow calls (the Workflow sandbox has no fs).
//
// Schema + status state machine: references/ledger-schema.md.
//
// v3 (review-engine-v3.md): the issue signal is `significance` (major|minor) +
// `kind` (mechanical|substantive), NOT the v2 4-tier `severity` (retired, kept
// nullable for legacy reads). The completion gate counts GATE-BLOCKING majors:
// `author-required` is lifecycle-active (it still demands eventual human work) but
// is gate-OK (it accumulates in the human queue across rounds, handled at 终审), so
// it never blocks a round gate. `close_criterion` is null at intake (the judge sets
// it on a valid-fixable verdict; required only then). New: `re-trial` status,
// `escalate` transient verdict, `tally`/`escalated` (trial bookkeeping the recall
// Mode-B consensus filter reads), and `docket`/`unadjudicated` queries for the clerk.
//
// CLI:
//   node ledger.js init   <ledger.json> [--manuscript P] [--venue vision|nlp|ml] [--round N]
//   node ledger.js add    <ledger.json> [--round N]      # reads a JSON array of rows on stdin
//   node ledger.js set    <ledger.json> <id> <status> [--k v ...]
//   node ledger.js count  <ledger.json>                  # active significance counts (JSON)
//   node ledger.js gate   <ledger.json>                  # PASS iff 0 gate-blocking active major
//   node ledger.js get    <ledger.json> [--status S] [--significance major|minor] [--kind K]
//   node ledger.js docket <ledger.json> [--round N]      # carried open-questions for the clerk
//   node ledger.js unadjudicated <ledger.json>           # active majors with no verdict yet
//   node ledger.js render <ledger.json>                  # (re)write the .md view
// Every mutating command re-renders the .md view next to the .json.

'use strict'
const fs = require('fs')
const path = require('path')

const SEVERITIES = ['blocker', 'major', 'minor', 'nit']   // v2 legacy, retired in v3
const SIGNIFICANCES = ['major', 'minor']                  // v3 intrinsic importance
const KINDS = ['mechanical', 'substantive']               // v3 contestability routing

// Lifecycle-ACTIVE: the row still demands work (not terminal). Includes
// author-required (a human will handle it) and the v2 review-mode discussion states.
const ACTIVE = new Set([
  'raised', 'in-trial', 're-trial', 'under-discussion', 'maintain-pending-tiebreak',
  'agreed-to-fix', 'agreed-to-fix-modified', 'valid-fixable', 'author-required',
])
// GATE-BLOCKING: the subset of ACTIVE that blocks a round's completion gate (spec
// §3.10). v3 EXCLUDES author-required (gate-ok; accumulates in the queue, handled at
// 终审) AND the v2 panel-review discussion states (under-discussion / *-tiebreak /
// agreed-to-fix*); those never appear in the v3 courtroom/auto loop, and including
// them could false-block the completion gate, so the gate keys on exactly the four
// v3 courtroom active states.
const GATE_BLOCKING = new Set(['raised', 'in-trial', 're-trial', 'valid-fixable'])
const TERMINAL = new Set(['closed', 'withdrawn', 'override', 'dropped', 'queued'])
const ALL_STATUS = new Set([...ACTIVE, ...TERMINAL])

// `escalate` is a transient trial directive (the row stays in-trial while the
// orchestrator re-runs at jurySize 12); it is never a stored terminal verdict.
const VERDICTS = new Set([null, 'invalid-drop', 'valid-fixable', 'author-required', 'escalate'])
const REASON_CODES = new Set([
  null, 'anchor-touching', 'hit-passage-cap', 'claim-meaning-change',
  'batched-nit', 'compile-failed', 'needs-human-input', 'polish-review',
])

// ---- core (module API) ----------------------------------------------------

function emptyLedger(meta = {}) {
  return { schema: 1, meta: { manuscript: null, venue_family: null, created_round: 1, assignment_unverified: [], ...meta }, issues: [] }
}

function load(file) {
  if (!fs.existsSync(file)) return emptyLedger()
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return emptyLedger()
  const led = JSON.parse(raw)
  if (!Array.isArray(led.issues)) led.issues = []
  if (!led.meta) led.meta = {}
  if (!Array.isArray(led.meta.assignment_unverified)) led.meta.assignment_unverified = []
  return led
}

function save(file, led) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(led, null, 2) + '\n', 'utf8')
  const mdFile = file.replace(/\.json$/i, '') + '.md'
  fs.writeFileSync(mdFile, renderMarkdown(led), 'utf8')
  return mdFile
}

function isActive(row) { return ACTIVE.has(row.status) }

// The effective v3 significance of a row: explicit `significance`, else mapped from
// a legacy v2 `severity` (blocker|major -> major; minor|nit -> minor), else null.
function sigOf(row) {
  if (row.significance) return row.significance
  if (row.severity === 'blocker' || row.severity === 'major') return 'major'
  if (row.severity === 'minor' || row.severity === 'nit') return 'minor'
  return null
}

function nextId(led) {
  let max = 0
  for (const r of led.issues) {
    const m = /^I-(\d+)$/.exec(r.id || '')
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return 'I-' + String(max + 1).padStart(2, '0')
}

// Normalize an incoming reviewer/charge row into a full ledger row.
// v3: close_criterion may be null at intake (status raised); it is REQUIRED only at
// status valid-fixable (enforced in setStatus). significance/kind default
// conservatively (major / substantive) so an unlabeled row routes to the trial, not
// silently to the off-gate polish track.
function normalizeRow(row, led, round) {
  if (row.severity && !SEVERITIES.includes(row.severity)) {
    throw new Error('bad severity: ' + row.severity)
  }
  if (row.significance && !SIGNIFICANCES.includes(row.significance)) {
    throw new Error('bad significance: ' + row.significance)
  }
  if (row.kind && !KINDS.includes(row.kind)) {
    throw new Error('bad kind: ' + row.kind)
  }
  const status = row.status || 'raised'
  if (status === 'valid-fixable' && !(row.close_criterion && String(row.close_criterion).trim())) {
    throw new Error('valid-fixable row requires a close_criterion: ' + JSON.stringify(row.summary || row))
  }
  return {
    id: row.id || nextId(led),
    passage_id: row.passage_id ?? null,
    significance: row.significance || sigOf(row) || 'major',
    kind: row.kind || 'substantive',
    severity: row.severity ?? null,           // v2 legacy, retired; left null in v3 rows
    section: row.section || '',
    evidence_anchor: row.evidence_anchor ?? null,
    summary: row.summary || '',
    references: row.references ?? null,    // canonical: what would settle it / sections implicated (trial unit-select reads it)
    close_criterion: row.close_criterion ?? null,
    status,
    verdict: row.verdict ?? null,
    reason_code: row.reason_code ?? null,
    tally: row.tally ?? null,                 // {valid,invalid,context_limited} from trial
    escalated: row.escalated ?? false,        // true if the charge went to the 12-juror tier
    reviewer_confidence: row.reviewer_confidence ?? null,  // max overall_confidence of its raisers
    raised_by: Array.isArray(row.raised_by) ? row.raised_by : (row.raised_by ? [row.raised_by] : []),
    raised_by_count: row.raised_by_count ?? (Array.isArray(row.raised_by) ? row.raised_by.length : 0),
    round_raised: row.round_raised ?? round ?? led.meta.created_round ?? 1,
    round_closed: row.round_closed ?? null,
    rounds_touched: Array.isArray(row.rounds_touched) ? row.rounds_touched : [],
    drafted_patch: row.drafted_patch ?? null,
    journal_ref: row.journal_ref ?? null,
    notes: row.notes || '',
  }
}

// Add rows; assigns ids sequentially. Returns the added rows.
function addIssues(led, rows, round) {
  const added = []
  for (const row of rows) {
    const full = normalizeRow(row, led, round)
    led.issues.push(full)
    added.push(full)
  }
  return added
}

function setStatus(led, id, status, fields = {}) {
  if (status && !ALL_STATUS.has(status)) throw new Error('unknown status: ' + status)
  const row = led.issues.find((r) => r.id === id)
  if (!row) throw new Error('no such id: ' + id)
  const nextStatus = status || row.status
  // apply field updates first so a close_criterion supplied in the same call counts
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'verdict' && !VERDICTS.has(v)) throw new Error('bad verdict: ' + v)
    if (k === 'reason_code' && !REASON_CODES.has(v)) throw new Error('bad reason_code: ' + v)
    if (k === 'significance' && v && !SIGNIFICANCES.includes(v)) throw new Error('bad significance: ' + v)
    if (k === 'kind' && v && !KINDS.includes(v)) throw new Error('bad kind: ' + v)
    row[k] = v
  }
  if (status) row.status = status
  if (nextStatus === 'valid-fixable' && !(row.close_criterion && String(row.close_criterion).trim())) {
    throw new Error('valid-fixable requires a close_criterion (set it in the same call): ' + id)
  }
  if (nextStatus === 'dropped' && !String(row.notes || '').trim() && !fields.notes) {
    throw new Error('dropped requires a reason in notes (never silently drop)')
  }
  return row
}

// Active counts by v3 significance, plus the gate-blocking major count (the /goal
// completion fact) and the accumulating author-required count.
function activeCounts(led) {
  const c = { major: 0, minor: 0, total: 0, gate_blocking_major: 0, author_required: 0 }
  for (const r of led.issues) {
    if (!isActive(r)) continue
    c.total++
    const sig = sigOf(r)
    if (sig === 'major') c.major++
    else if (sig === 'minor') c.minor++
    if (r.status === 'author-required') c.author_required++
    if (sig === 'major' && GATE_BLOCKING.has(r.status)) c.gate_blocking_major++
  }
  return c
}

// The /goal completion fact: 0 GATE-BLOCKING active major. author-required majors
// (queued for the human) do NOT block it; that is what lets the AFK loop wind down
// with real questions waiting in the queue for 终审.
function gatePass(led) {
  return activeCounts(led).gate_blocking_major === 0
}

function query(led, { status, significance, kind, severity } = {}) {
  return led.issues.filter((r) =>
    (!status || r.status === status) &&
    (!significance || sigOf(r) === significance) &&
    (!kind || r.kind === kind) &&
    (!severity || r.severity === severity))
}

// The clerk's carried open-question docket: rows from PRIOR rounds (round_raised < N)
// still needing attention. If round is omitted, all such open rows.
function docket(led, round) {
  // re-trial is an INTRA-round status (resolved before the clerk runs at the round
  // boundary), so it is not a carried open-question.
  const CARRIED = new Set(['author-required', 'queued', 'valid-fixable'])
  return led.issues.filter((r) =>
    CARRIED.has(r.status) && (round == null || (r.round_raised != null && r.round_raised < round)))
}

// Active majors that have not been adjudicated (no verdict): budget exhaustion or a
// stalled trial cannot fake completion while these exist.
function unadjudicated(led) {
  const PENDING = new Set(['raised', 'in-trial', 're-trial'])
  return led.issues.filter((r) => sigOf(r) === 'major' && PENDING.has(r.status) && r.verdict == null)
}

// ---- markdown view --------------------------------------------------------

function cell(s) { return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() }

function statusCell(r) {
  const tag = r.reason_code ? ` (${r.reason_code})` : (r.verdict ? ` (${r.verdict})` : '')
  return cell(r.status + tag)
}

function renderMarkdown(led) {
  const rank = { major: 0, minor: 1 }
  const rows = led.issues.slice().sort((a, b) =>
    (isActive(b) - isActive(a)) || ((rank[sigOf(a)] ?? 9) - (rank[sigOf(b)] ?? 9)) ||
    String(a.id).localeCompare(String(b.id)))
  const c = activeCounts(led)
  const out = []
  out.push('# Ledger (rendered view -- do not edit; source of truth is the .json)')
  out.push('')
  out.push(`Manuscript: ${led.meta.manuscript || '(unset)'} | venue: ${led.meta.venue_family || '(unset)'}`)
  if ((led.meta.assignment_unverified || []).length) {
    out.push(`Assignment-unverified reviewers: ${led.meta.assignment_unverified.join(', ')}`)
  }
  out.push('')
  out.push(`Active: ${c.total} (major ${c.major}, minor ${c.minor}; author-required ${c.author_required}). ` +
    `Completion gate (0 gate-blocking active major): ${gatePass(led) ? 'PASS' : 'FAIL'} ` +
    `(gate-blocking majors: ${c.gate_blocking_major}).`)
  out.push('')
  out.push('| id | sig | kind | status | section | summary | close_criterion | by | rounds |')
  out.push('|----|-----|------|--------|---------|---------|-----------------|----|--------|')
  for (const r of rows) {
    out.push('| ' + [
      cell(r.id), cell(sigOf(r)), cell(r.kind), statusCell(r), cell(r.section),
      cell(r.summary), cell(r.close_criterion), cell((r.raised_by || []).join(',')),
      cell([r.round_raised, r.round_closed].filter((x) => x != null).join('->')),
    ].join(' | ') + ' |')
  }
  out.push('')
  return out.join('\n')
}

// ---- CLI ------------------------------------------------------------------

function parseFlags(argv) {
  const flags = {}
  const pos = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1]; i++ }
    else pos.push(argv[i])
  }
  return { flags, pos }
}

function readStdin() {
  try {
    const data = fs.readFileSync(0, 'utf8')
    return data && data.trim() ? JSON.parse(data) : []
  } catch (e) { return [] }
}

function main() {
  const [cmd, file, ...rest] = process.argv.slice(2)
  if (!cmd || !file) {
    console.error('usage: node ledger.js <init|add|set|count|gate|get|docket|unadjudicated|render> <ledger.json> [...]')
    process.exit(2)
  }
  const { flags, pos } = parseFlags(rest)

  if (cmd === 'init') {
    const led = emptyLedger({
      manuscript: flags.manuscript || null,
      venue_family: flags.venue || null,
      created_round: flags.round ? parseInt(flags.round, 10) : 1,
    })
    const md = save(file, led)
    console.log(JSON.stringify({ ok: true, ledger: file, view: md }))
    return
  }

  const led = load(file)

  if (cmd === 'add') {
    const rows = readStdin()
    if (!Array.isArray(rows)) throw new Error('add expects a JSON array on stdin')
    const round = flags.round ? parseInt(flags.round, 10) : undefined
    const added = addIssues(led, rows, round)
    save(file, led)
    console.log(JSON.stringify({ ok: true, added: added.map((r) => r.id) }))
  } else if (cmd === 'set') {
    const [id, status] = pos
    const fields = {}
    for (const [k, v] of Object.entries(flags)) {
      if (['verdict', 'reason_code', 'section', 'summary', 'close_criterion', 'notes', 'passage_id', 'journal_ref', 'significance', 'kind'].includes(k)) {
        fields[k] = v === 'null' ? null : v
      } else if (k === 'round_closed') {
        fields[k] = parseInt(v, 10)
      } else if (k === 'escalated') {
        fields[k] = v === 'true'
      }
    }
    setStatus(led, id, status, fields)
    save(file, led)
    console.log(JSON.stringify({ ok: true, id, status }))
  } else if (cmd === 'count') {
    console.log(JSON.stringify(activeCounts(led)))
  } else if (cmd === 'gate') {
    const pass = gatePass(led)
    console.log(pass ? 'PASS' : 'FAIL ' + JSON.stringify(activeCounts(led)))
    process.exit(pass ? 0 : 1)
  } else if (cmd === 'get') {
    console.log(JSON.stringify(query(led, { status: flags.status, significance: flags.significance, kind: flags.kind, severity: flags.severity }), null, 2))
  } else if (cmd === 'docket') {
    const round = flags.round ? parseInt(flags.round, 10) : undefined
    console.log(JSON.stringify(docket(led, round), null, 2))
  } else if (cmd === 'unadjudicated') {
    console.log(JSON.stringify(unadjudicated(led), null, 2))
  } else if (cmd === 'render') {
    const md = save(file, led)
    console.log(JSON.stringify({ ok: true, view: md }))
  } else {
    console.error('unknown command: ' + cmd)
    process.exit(2)
  }
}

if (require.main === module) main()

module.exports = {
  emptyLedger, load, save, renderMarkdown, addIssues, setStatus, normalizeRow,
  activeCounts, gatePass, query, docket, unadjudicated, isActive, sigOf, nextId,
  SEVERITIES, SIGNIFICANCES, KINDS, ACTIVE, GATE_BLOCKING, TERMINAL, VERDICTS, REASON_CODES,
}
