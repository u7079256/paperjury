// edit-audit.workflow.js -- v3 edit-safety SEMANTIC half for RISKY non-anchor edits
// (review-engine-v3.md §3.8). The deterministic pre-filter (anchor-diff + cross-ref)
// classifies each drafted edit; LOW edits apply directly under compile-guard+journal.
// A RISKY edit (a changed salient token also appears in OTHER passages) comes here for
// a make-sense + cross-section-alignment check: does the rewritten span read correctly
// in place, AND is it consistent with the other passages where its changed tokens live
// (e.g. a result number still matches the table, a redefined symbol stays coherent)?
//
// This is meaning-audit GENERALIZED beyond the 7 frozen anchors. The frozen-anchor
// four-state audit + the arc check remain meaning-audit.workflow.js (unchanged, run by
// the orchestrator when anchor-diff flags an anchor); edit-audit covers the non-anchor
// risky edits cross-ref surfaces. Verdict gates the orchestrator: holds -> apply;
// drift -> revert + queue (reason claim-meaning-change).
//
// args (JSON STRING -- parse defensively):
//   { edits:[ {issue_id, before, after, cross_ref_hits:[{token, passage_id}]} ],
//     passages:[ {passage_id, text} ] }     // to resolve cross_ref_hits to text
// Returns { edit_verdicts:[ {issue_id, verdict, reason, offending_text} ] }.

export const meta = {
  name: 'edit-audit',
  description: 'v3 edit-safety: judge each RISKY non-anchor edit for make-sense + cross-section alignment against the other passages its changed tokens appear in. holds -> apply; drift -> queue. Generalizes meaning-audit beyond frozen anchors. paperjury review-engine v3.',
  phases: [{ title: 'EditAudit', detail: 'one agent per risky edit: in-place sense + cross-section consistency' }],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const edits = A.edits || []
const passages = A.passages || []
const byId = new Map(passages.map((p) => [p.passage_id, p]))
const ISOLATION = 'Judge ONLY the edit and the passages quoted here. Do not read files or search the project.'

const VERDICT = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['holds', 'drift'] },
    reason: { type: 'string' },
    offending_text: { type: ['string', 'null'] },
  },
  required: ['verdict', 'reason', 'offending_text'],
}

function refsText(hits) {
  const seen = new Set()
  const out = []
  for (const h of (hits || [])) {
    if (seen.has(h.passage_id)) continue
    seen.add(h.passage_id)
    const p = byId.get(h.passage_id)
    if (p) out.push(`--- passage ${h.passage_id} (mentions ${h.token}) ---\n${p.text}`)
  }
  return out.length ? out.join('\n\n') : '(referenced passages not provided)'
}

function auditPrompt(e) {
  return [
    'You audit ONE applied edit to a CS paper for SAFETY. The edit changed a token (a number,',
    'symbol, defined term, or \\ref/\\cite/\\label key) that ALSO appears in other passages, so',
    'it could create a cross-section inconsistency. Decide ONE verdict:',
    '- holds: the rewritten text reads correctly in place AND stays consistent with the other',
    '  passages shown (no number/table mismatch, no broken reference, no contradicted definition).',
    '- drift: the edit no longer makes sense in place OR conflicts with another passage (e.g. a',
    '  result number now disagrees with the table, a symbol/term was redefined incoherently, a',
    '  reference no longer resolves). Set offending_text to the exact conflicting current text.',
    'Judge MEANING, not surface wording; do not flag a faithful edit, do not rubber-stamp a real',
    'conflict.',
    ISOLATION,
    '',
    `EDIT [${e.issue_id}]:`,
    `  before: "${e.before}"`,
    `  after:  "${e.after}"`,
    '',
    'OTHER PASSAGES that mention the changed token(s):',
    refsText(e.cross_ref_hits),
  ].join('\n')
}

const edit_verdicts = edits.length
  ? (await parallel(edits.map((e) => () =>
      agent(auditPrompt(e), { label: `edit-audit:${e.issue_id}`, phase: 'EditAudit', schema: VERDICT })
        .then((v) => (v ? { issue_id: e.issue_id, verdict: v.verdict, reason: v.reason, offending_text: v.offending_text }
          : { issue_id: e.issue_id, verdict: 'drift', reason: 'edit-audit agent unavailable; queued (safe default)', offending_text: null }))))).filter(Boolean)
  : []

const drift = edit_verdicts.filter((v) => v.verdict === 'drift').length
log(`edit-audit: ${edit_verdicts.length} risky edits judged, ${drift} drift -> queue, ${edit_verdicts.length - drift} hold -> apply`)
return { edit_verdicts }
