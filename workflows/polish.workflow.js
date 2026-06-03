// polish.workflow.js -- v3 POLISH TRACK (review-engine-v3.md §3.7). The OFF-GATE,
// never-drop, batch counterpart to the per-charge drafter. Handles the two routes that
// bypass the 5-tier:
//   mechanical  -> a batch COPY-EDIT pass: a minimal {before,after} fix per item
//                  (typo, formatting, notation slip).
//   minor-substantive -> a batch LIGHT-CHECK: per item one of edit / drop (invalid;
//                  a recall backstop re-checks drops) / escalate_to_trial (it is
//                  actually substantive-major -> the orchestrator sets status re-trial
//                  and runs the conditional re-trial pass) / flag (needs the author).
// Every produced patch is exact-string {before,after} and feeds the SAME edit-safety
// guard downstream. This workflow is mode-agnostic: it RETURNS patches + decisions; the
// orchestrator branches review (patches -> author CHECKLIST, queued reason polish-review)
// vs auto (apply LOW-risk non-anchor, queue RISKY).
//
// args (JSON STRING -- parse defensively):
//   { items:[ {issue_id, section, summary, evidence_anchor, significance, kind} ],
//     paper, venueProfile }
// Returns { patches:[{issue_id, kind, before, after, rationale, before_in_text, no_op}],
//           dropped:[{issue_id, reason}], escalate_to_trial:[{issue_id, reason}],
//           flagged:[{issue_id, reason}] }.

export const meta = {
  name: 'polish',
  description: 'v3 polish track: batch copy-edit for mechanical items + batch light-check for minor-substantive items (edit/drop/escalate/flag). Off-gate, never-drop; returns exact-string patches for the edit-safety guard. paperjury review-engine v3.',
  phases: [{ title: 'Polish', detail: 'one agent per item: copy-edit (mechanical) or light-check (minor-substantive)' }],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const items = A.items || []
const paper = A.paper || ''
const venueProfile = A.venueProfile || '(default plain CS prose)'
const ISOLATION = 'Work ONLY from the manuscript quoted here. Do not read files or search the project.'

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const paperNorm = norm(paper)
const inText = (b) => norm(b).length > 0 && paperNorm.includes(norm(b))

const COPY = {
  type: 'object', additionalProperties: false,
  properties: { before: { type: 'string' }, after: { type: 'string' }, rationale: { type: 'string' } },
  required: ['before', 'after', 'rationale'],
}
const LIGHT = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['edit', 'drop', 'escalate', 'flag'] },
    before: { type: 'string' }, after: { type: 'string' }, reason: { type: 'string' },
  },
  required: ['action', 'before', 'after', 'reason'],
}

function copyPrompt(it) {
  return [
    'You make ONE minimal COPY-EDIT to a CS paper (a typo, a formatting slip, an inconsistent',
    'notation token, an awkward phrasing). Output an exact-string patch:',
    '- before: copy VERBATIM the smallest contiguous span you change (must appear in the text).',
    '- after: that span fixed. Plain CS prose, LaTeX-safe, NO em-dashes, no new citations/numbers,',
    '  no meaning change beyond the mechanical fix. If there is nothing to fix, set before==after.',
    `Venue style: ${venueProfile}`,
    ISOLATION,
    '',
    `ITEM [${it.section}]: ${it.summary}`,
    it.evidence_anchor ? `evidence_anchor: "${it.evidence_anchor}"` : '',
    '', 'THE PAPER:', '"""', paper, '"""',
  ].filter(Boolean).join('\n')
}

function lightPrompt(it) {
  return [
    'You LIGHT-CHECK one minor-substantive review item on a CS paper. Choose ONE action:',
    '- edit: a small, honest text fix closes it -> give an exact-string before/after patch',
    '  (before VERBATIM from the text; plain prose; no em-dashes; no new numbers/citations).',
    '- drop: the item is invalid or immaterial -> say why (a recall auditor will re-check drops).',
    '- escalate: on a closer look this is actually a SUBSTANTIVE, MAJOR flaw that deserves the',
    '  full trial -> say why (it will be re-tried, not silently polished).',
    '- flag: valid but cannot be closed by editing existing text (needs the author) -> say why.',
    'For non-edit actions set before==after=="" .',
    `Venue style: ${venueProfile}`,
    ISOLATION,
    '',
    `ITEM [${it.significance}/${it.kind}] ${it.section}: ${it.summary}`,
    it.evidence_anchor ? `evidence_anchor: "${it.evidence_anchor}"` : '',
    '', 'THE PAPER:', '"""', paper, '"""',
  ].filter(Boolean).join('\n')
}

const patches = []
const dropped = []
const escalate_to_trial = []
const flagged = []

await parallel(items.map((it) => async () => {
  if (it.kind === 'mechanical') {
    const p = await agent(copyPrompt(it), { label: `polish-copy:${it.issue_id}`, phase: 'Polish', schema: COPY })
    if (!p) { flagged.push({ issue_id: it.issue_id, reason: 'copy-edit agent unavailable' }); return }
    if (norm(p.before) === norm(p.after)) { dropped.push({ issue_id: it.issue_id, reason: 'no mechanical change needed: ' + p.rationale }); return }
    patches.push({ issue_id: it.issue_id, kind: 'mechanical', before: p.before, after: p.after, rationale: p.rationale, before_in_text: inText(p.before), no_op: false })
  } else {
    const r = await agent(lightPrompt(it), { label: `polish-light:${it.issue_id}`, phase: 'Polish', schema: LIGHT })
    if (!r) { flagged.push({ issue_id: it.issue_id, reason: 'light-check agent unavailable' }); return }
    if (r.action === 'drop') dropped.push({ issue_id: it.issue_id, reason: r.reason })
    else if (r.action === 'escalate') escalate_to_trial.push({ issue_id: it.issue_id, reason: r.reason })
    else if (r.action === 'flag') flagged.push({ issue_id: it.issue_id, reason: r.reason })
    else if (r.action === 'edit') {
      if (norm(r.before) === norm(r.after) || !norm(r.before)) flagged.push({ issue_id: it.issue_id, reason: 'edit was a no-op: ' + r.reason })
      else patches.push({ issue_id: it.issue_id, kind: 'minor-substantive', before: r.before, after: r.after, rationale: r.reason, before_in_text: inText(r.before), no_op: false })
    }
  }
}))

log(`polish: ${items.length} items -> ${patches.length} patches, ${dropped.length} dropped, ${escalate_to_trial.length} escalated-to-trial, ${flagged.length} flagged`)
return { patches, dropped, escalate_to_trial, flagged }
