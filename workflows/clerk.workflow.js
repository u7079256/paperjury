// clerk.workflow.js -- v3 round-boundary CLERK / 书记官 (review-engine-v3.md §4.2).
// NOT part of the core trial. Between rounds it reconciles the clean round's result
// into the single cumulative ledger and produces the DETERMINISTIC convergence inputs.
// Two jobs:
//   RECONCILE: each carried open-question (prior-round author-required / queued /
//     valid-fixable / re-trial) vs this round's applied edits + the current paper ->
//     closed | invalidated | still-open. "invalidated-by-the-edit" = the evidence_anchor
//     is no longer present verbatim (deterministic) AND no equivalent assertion remains
//     (the clerk judges the latter).
//   DEDUP: each this-round issue (from the clean re-review) vs the carried rows. The
//     merge KEY is deterministic: merge iff SAME passage_id AND the clerk's same-issue
//     confidence >= threshold; BORDERLINE -> bias to genuinely-new (recall-safe: a missed
//     merge re-adds a row, never silently drops; convergence stays an honest "nothing new"
//     test, not a proxy). This is the fix for "a semantic clerk is a hidden 2nd source of
//     truth": the agent only judges similarity; the GATE is deterministic.
//
// args (JSON STRING -- parse defensively):
//   { carried:   [ {ledger_id, passage_id, section, summary, evidence_anchor, status} ],
//     thisRound: [ {ledger_id, passage_id, section, summary, evidence_anchor, status} ],
//     appliedEdits:[ {issue_id, before, after} ],
//     paper, simThreshold }
// Returns { reconciled:[{ledger_id, outcome, reason}], merges:[{this_round_id, into}],
//           genuinely_new:[ledger_id...], genuinely_new_count, new_closures_count,
//           new_author_required_count, converged }.

export const meta = {
  name: 'clerk',
  description: 'v3 clerk: reconcile carried open-questions vs this round\'s edits (closed/invalidated/still-open) and dedup this round\'s issues vs carried via a deterministic passage_id + similarity merge key (borderline -> genuinely-new). Emits the deterministic convergence counts. paperjury review-engine v3.',
  phases: [
    { title: 'Reconcile', detail: 'judge each carried open-question against this round\'s edits' },
    { title: 'Dedup', detail: 'match this round\'s issues to carried rows by passage_id + similarity' },
  ],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const carried = A.carried || []
const thisRound = A.thisRound || []
const appliedEdits = A.appliedEdits || []
const paper = A.paper || ''
const simThreshold = A.simThreshold ?? 0.8
const ISOLATION = 'Work ONLY from the rows, edits, and manuscript quoted here. Do not read files or search the project.'

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const paperNorm = norm(paper)
const presentVerbatim = (q) => { const n = norm(q); return n.length > 0 && paperNorm.includes(n) }

const RECON = {
  type: 'object', additionalProperties: false,
  properties: {
    outcome: { type: 'string', enum: ['closed', 'invalidated', 'still-open'] },
    reason: { type: 'string' },
  },
  required: ['outcome', 'reason'],
}
const DEDUP = {
  type: 'object', additionalProperties: false,
  properties: {
    same_as: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['same_as', 'confidence', 'reason'],
}

const editsText = appliedEdits.length
  ? appliedEdits.map((e) => `- [${e.issue_id}] "${e.before}" -> "${e.after}"`).join('\n')
  : '(no edits applied this round)'

function reconPrompt(row) {
  return [
    'You are the clerk reconciling a CARRIED open review issue against this round\'s edits and',
    'the current paper. Decide ONE outcome:',
    '- closed: an applied edit (or the current text) now satisfies the issue.',
    '- invalidated: the edits removed/rewrote the text so the issue is moot (no longer applies).',
    '- still-open: neither; it still stands.',
    row.evidence_anchor ? `NOTE: the issue\'s original evidence quote is ${presentVerbatim(row.evidence_anchor) ? 'STILL present' : 'NO LONGER present'} verbatim in the current paper.` : '',
    ISOLATION,
    '',
    `CARRIED ISSUE [${row.ledger_id}] (${row.status}) ${row.section}: ${row.summary}`,
    row.evidence_anchor ? `  original evidence_anchor: "${row.evidence_anchor}"` : '',
    '', 'EDITS APPLIED THIS ROUND:', editsText,
    '', 'CURRENT PAPER:', '"""', paper, '"""',
  ].filter(Boolean).join('\n')
}

function dedupPrompt(row, candidates) {
  return [
    'You are the clerk checking whether a NEWLY-raised issue is the SAME underlying issue as one',
    'already on the docket (a re-raise) or genuinely new. Compare ONLY against the candidates',
    'below (they share the same passage). If it is the same issue as one of them, set same_as to',
    'that ledger_id and confidence in [0,1]; if it is genuinely new (or you are unsure), set',
    'same_as=null. When unsure, prefer null (a missed merge is recoverable; a wrong merge hides',
    'a distinct issue).',
    ISOLATION,
    '',
    `NEW ISSUE [${row.ledger_id}] ${row.section}: ${row.summary}`,
    row.evidence_anchor ? `  evidence_anchor: "${row.evidence_anchor}"` : '',
    '', 'SAME-PASSAGE CANDIDATES:',
    candidates.map((c) => `  [${c.ledger_id}] ${c.section}: ${c.summary}`).join('\n'),
  ].join('\n')
}

// --- Reconcile carried rows (parallel) ---
const reconciled = carried.length
  ? (await parallel(carried.map((row) => () =>
      agent(reconPrompt(row), { label: `reconcile:${row.ledger_id}`, phase: 'Reconcile', schema: RECON })
        .then((r) => (r ? { ledger_id: row.ledger_id, outcome: r.outcome, reason: r.reason } : { ledger_id: row.ledger_id, outcome: 'still-open', reason: 'reconcile agent unavailable; kept open (safe)' }))))).filter(Boolean)
  : []

// --- Dedup this round's issues vs carried, by passage_id + similarity ---
const carriedByPassage = new Map()
for (const c of carried) {
  const k = c.passage_id || '__none__'
  if (!carriedByPassage.has(k)) carriedByPassage.set(k, [])
  carriedByPassage.get(k).push(c)
}
const carriedById = new Map(carried.map((c) => [c.ledger_id, c]))

const merges = []
const genuinelyNew = []
await parallel(thisRound.map((row) => async () => {
  const cands = carriedByPassage.get(row.passage_id || '__none__') || []
  if (!cands.length) { genuinelyNew.push(row.ledger_id); return }
  const d = await agent(dedupPrompt(row, cands), { label: `dedup:${row.ledger_id}`, phase: 'Dedup', schema: DEDUP })
  // DETERMINISTIC merge gate: same passage_id (guaranteed by candidate grouping) AND a real
  // candidate id AND confidence over threshold. Else genuinely-new (borderline bias).
  const cand = d && d.same_as ? carriedById.get(d.same_as) : null
  const samePassage = cand && (cand.passage_id || '__none__') === (row.passage_id || '__none__')
  if (cand && samePassage && typeof d.confidence === 'number' && d.confidence >= simThreshold) {
    merges.push({ this_round_id: row.ledger_id, into: d.same_as })
  } else {
    genuinelyNew.push(row.ledger_id)
  }
}))

const newClosures = reconciled.filter((r) => r.outcome === 'closed' || r.outcome === 'invalidated').length
const newAuthorRequired = genuinelyNew.filter((id) => {
  const r = thisRound.find((x) => x.ledger_id === id)
  return r && r.status === 'author-required'
}).length
const converged = genuinelyNew.length === 0 && newClosures === 0 && newAuthorRequired === 0

log(`clerk: reconciled ${reconciled.length} carried (${newClosures} closed/invalidated), ${merges.length} re-raises merged, ${genuinelyNew.length} genuinely-new (${newAuthorRequired} new author-required); converged=${converged}`)

return {
  reconciled, merges, genuinely_new: genuinelyNew,
  genuinely_new_count: genuinelyNew.length, new_closures_count: newClosures,
  new_author_required_count: newAuthorRequired, converged,
}
