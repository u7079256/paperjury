// recall-audit.workflow.js -- v2 prosecution-side APPEAL (REVIEW_ENGINE_V2 §3-4).
// Fixes the recall hole left by "only the defense can appeal": a FRESH skeptic (not
// the original reviewer, kept fresh to avoid re-entrenchment) re-examines EVERY drop
// -- both the grand-jury obvious-drops and the trial invalid-drops -- and asks "was
// this drop WRONG? is the charge actually valid despite being dropped?" A wrongly
// dropped real issue is REVIVED -> re-trial or escalate. Recall is non-negotiable,
// so the bias is to revive: ANY single skeptic that revives flags the charge.
//
// args (JSON STRING -- parse defensively):
//   { drops:[ {charge_id, severity, section, summary, close_criterion, evidence_anchor,
//              drop_reason, source} ],     // source: 'grand-jury' | 'trial'
//     units:[ {unit_id, section, text} ],
//     skeptics }                            // 1 | 1 | 2 by intensity
// Returns { confirmed_drops:[charge_id], revived:[{charge_id, reason, recommend}] }.
// recommend: 're-trial' for a grand-jury drop (never got a trial), 'escalate' for a
// trial invalid-drop (already lost a full trial; send the conflict to the human).

export const meta = {
  name: 'recall-audit',
  description: 'v2 recall auditor: a fresh skeptic re-checks every dropped charge and revives wrongly-dropped real issues (bias to revive; recall is non-negotiable). paper-review-loop review-engine v2.',
  phases: [{ title: 'Recall', detail: 'fresh skeptics try to revive each dropped charge' }],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const drops = A.drops || []
const units = A.units || []
const skeptics = Math.max(1, A.skeptics ?? 1)
const ISOLATION = 'Judge ONLY the text quoted in this prompt. Do not read files, search the project, or use any tool to find other context; base your judgment solely on what is quoted here.'

const REVIVE = {
  type: 'object', additionalProperties: false,
  properties: {
    revive: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['revive', 'reason'],
}

const contextText = units.map((u) => `=== ${u.unit_id} (${u.section}) ===\n${u.text}`).join('\n\n')

function revivePrompt(d) {
  return [
    'You are a fresh RECALL AUDITOR (prosecution-side appeal). The charge below was',
    'DROPPED. You did not see the original trial; judge independently. Your job: was',
    'the drop WRONG? Set revive=true if, reading the text yourself, the charge is in',
    'fact a real and material flaw that should NOT have been dropped. Set revive=false',
    'if the drop was correct (the charge really does not hold or is immaterial). Recall',
    'matters: if it is a genuine flaw, revive it; but do not revive an immaterial or',
    'truly-invalid charge just to be safe.',
    ISOLATION,
    '',
    `DROPPED CHARGE: [${d.severity}] ${d.section} -- ${d.summary}`,
    `  close_criterion: ${d.close_criterion}`,
    `  evidence_anchor: "${d.evidence_anchor}"`,
    `  why it was dropped (${d.source}): ${d.drop_reason}`,
    '',
    'THE PAPER TEXT:', '"""', contextText, '"""',
  ].join('\n')
}

const results = (await parallel(drops.map((d) => () =>
  parallel(Array.from({ length: skeptics }, () => () =>
    agent(revivePrompt(d), { label: `recall:${d.charge_id}`, phase: 'Recall', schema: REVIVE })))
    .then((vs) => {
      const v = vs.filter(Boolean)
      const revived = v.some((x) => x.revive) // bias to revive: any single revive flags it
      return { drop: d, revived, reason: revived ? v.filter((x) => x.revive).map((x) => x.reason).join(' | ') : null }
    })
))).filter(Boolean)

const revived = results.filter((r) => r.revived).map((r) => ({
  charge_id: r.drop.charge_id, reason: r.reason,
  recommend: r.drop.source === 'trial' ? 'escalate' : 're-trial',
}))
const confirmed_drops = results.filter((r) => !r.revived).map((r) => r.drop.charge_id)

log(`recall audit: ${drops.length} drops re-checked -> ${revived.length} revived, ${confirmed_drops.length} drops confirmed`)

return { confirmed_drops, revived }
