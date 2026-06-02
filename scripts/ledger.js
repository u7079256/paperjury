#!/usr/bin/env node
// ledger.js -- the paper-review-loop ledger: JSON source of truth + rendered
// Markdown view (decided 2026-06-01, D1). Dependency-free Node. Works as a
// require() module AND as a Bash-callable CLI, because the deterministic guards
// run orchestrator-side between workflow calls (the Workflow sandbox has no fs).
//
// Schema + status state machine: references/ledger-schema.md.
//
// CLI:
//   node ledger.js init   <ledger.json> [--manuscript P] [--venue vision|nlp|ml] [--round N]
//   node ledger.js add    <ledger.json> [--round N]      # reads a JSON array of rows on stdin
//   node ledger.js set    <ledger.json> <id> <status> [--k v ...]
//   node ledger.js count  <ledger.json>                  # active severity counts (JSON)
//   node ledger.js gate   <ledger.json>                  # PASS iff 0 active blocker/major
//   node ledger.js get    <ledger.json> [--status S] [--severity Sev]
//   node ledger.js render <ledger.json>                  # (re)write the .md view
// Every mutating command re-renders the .md view next to the .json.

'use strict'
const fs = require('fs')
const path = require('path')

const SEVERITIES = ['blocker', 'major', 'minor', 'nit']

const ACTIVE = new Set([
  'raised', 'in-trial', 'under-discussion', 'maintain-pending-tiebreak',
  'agreed-to-fix', 'agreed-to-fix-modified', 'valid-fixable', 'author-required',
])
const TERMINAL = new Set(['closed', 'withdrawn', 'override', 'dropped', 'queued'])
const ALL_STATUS = new Set([...ACTIVE, ...TERMINAL])

const VERDICTS = new Set([null, 'invalid-drop', 'valid-fixable', 'author-required', 'split'])
const REASON_CODES = new Set([
  null, 'anchor-touching', 'hit-passage-cap', 'claim-meaning-change',
  'batched-nit', 'compile-failed', 'needs-human-input',
])

// ---- core (module API) ----------------------------------------------------

function emptyLedger(meta = {}) {
  return { schema: 1, meta: { manuscript: null, venue_family: null, created_round: 1, ...meta }, issues: [] }
}

function load(file) {
  if (!fs.existsSync(file)) return emptyLedger()
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return emptyLedger()
  const led = JSON.parse(raw)
  if (!Array.isArray(led.issues)) led.issues = []
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

function nextId(led) {
  let max = 0
  for (const r of led.issues) {
    const m = /^I-(\d+)$/.exec(r.id || '')
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return 'I-' + String(max + 1).padStart(2, '0')
}

// Normalize an incoming reviewer/charge row into a full ledger row.
function normalizeRow(row, led, round) {
  if (!row.close_criterion || !String(row.close_criterion).trim()) {
    throw new Error('row missing close_criterion: ' + JSON.stringify(row.summary || row))
  }
  if (row.severity && !SEVERITIES.includes(row.severity)) {
    throw new Error('bad severity: ' + row.severity)
  }
  return {
    id: row.id || nextId(led),
    passage_id: row.passage_id ?? null,
    severity: row.severity || 'major',
    section: row.section || '',
    evidence_anchor: row.evidence_anchor ?? null,
    summary: row.summary || '',
    close_criterion: row.close_criterion,
    status: row.status || 'raised',
    verdict: row.verdict ?? null,
    reason_code: row.reason_code ?? null,
    raised_by: Array.isArray(row.raised_by) ? row.raised_by : (row.raised_by ? [row.raised_by] : []),
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
  if (status) row.status = status
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'verdict' && !VERDICTS.has(v)) throw new Error('bad verdict: ' + v)
    if (k === 'reason_code' && !REASON_CODES.has(v)) throw new Error('bad reason_code: ' + v)
    row[k] = v
  }
  if ((status === 'dropped') && !String(row.notes || '').trim() && !fields.notes) {
    throw new Error('dropped requires a reason in notes (never silently drop)')
  }
  return row
}

function activeCounts(led) {
  const c = { blocker: 0, major: 0, minor: 0, nit: 0, total: 0 }
  for (const r of led.issues) {
    if (!isActive(r)) continue
    c.total++
    if (c[r.severity] !== undefined) c[r.severity]++
  }
  return c
}

// The auto /goal completion fact: 0 active blocker AND 0 active major.
function gatePass(led) {
  const c = activeCounts(led)
  return c.blocker === 0 && c.major === 0
}

function query(led, { status, severity } = {}) {
  return led.issues.filter((r) =>
    (!status || r.status === status) && (!severity || r.severity === severity))
}

// ---- markdown view --------------------------------------------------------

function cell(s) { return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() }

function statusCell(r) {
  const tag = r.reason_code ? ` (${r.reason_code})` : (r.verdict ? ` (${r.verdict})` : '')
  return cell(r.status + tag)
}

function renderMarkdown(led) {
  const rank = { blocker: 0, major: 1, minor: 2, nit: 3 }
  const rows = led.issues.slice().sort((a, b) =>
    (isActive(b) - isActive(a)) || ((rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)) ||
    String(a.id).localeCompare(String(b.id)))
  const c = activeCounts(led)
  const out = []
  out.push('# Ledger (rendered view -- do not edit; source of truth is the .json)')
  out.push('')
  out.push(`Manuscript: ${led.meta.manuscript || '(unset)'} | venue: ${led.meta.venue_family || '(unset)'}`)
  out.push('')
  out.push(`Active: ${c.total} (blocker ${c.blocker}, major ${c.major}, minor ${c.minor}, nit ${c.nit}). ` +
    `Completion gate (0 active blocker/major): ${gatePass(led) ? 'PASS' : 'FAIL'}.`)
  out.push('')
  out.push('| id | sev | status | section | summary | close_criterion | by | rounds |')
  out.push('|----|-----|--------|---------|---------|-----------------|----|--------|')
  for (const r of rows) {
    out.push('| ' + [
      cell(r.id), cell(r.severity), statusCell(r), cell(r.section),
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
    console.error('usage: node ledger.js <init|add|set|count|gate|get|render> <ledger.json> [...]')
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
      if (['verdict', 'reason_code', 'section', 'summary', 'close_criterion', 'notes', 'passage_id', 'journal_ref'].includes(k)) {
        fields[k] = v === 'null' ? null : v
      } else if (k === 'round_closed') {
        fields[k] = parseInt(v, 10)
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
    console.log(JSON.stringify(query(led, { status: flags.status, severity: flags.severity }), null, 2))
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
  activeCounts, gatePass, query, isActive, nextId,
  SEVERITIES, ACTIVE, TERMINAL, VERDICTS, REASON_CODES,
}
