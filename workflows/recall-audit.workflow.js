// recall-audit.workflow.js -- v3 RECALL (review-engine-v3.md §3.6/§3.9). Two modes,
// both fresh skeptics (decorrelated from the bodies whose output they check), run
// AFTER trial AND polish, BEFORE the drafter:
//   MODE A (revive drops): re-examine EVERY drop (trial invalid-drops + polish-dropped
//     invalids). Was the drop WRONG? Bias to revive (recall is non-negotiable): ANY
//     single skeptic that revives flags it. recommend = 're-trial' for a never-tried
//     drop, 'escalate' for a drop that already lost a full trial.
//   MODE B (consensus spot-check): for a valid-fixable MAJOR that won by STRONG
//     consensus, a fresh skeptic asks "could this consensus be CORRELATED-WRONG?" --
//     i.e. is the agreed flaw actually illusory, or would the agreed fix HARM the
//     paper? This decorrelates from the jury that produced the verdict (a larger jury
//     would not). sound -> hold (proceed to draft); not sound -> to-author-required
//     (do not auto-edit on a possibly-wrong consensus). The >=80%-at-tier-5 / not-
//     escalated FILTER is applied ORCHESTRATOR-side; this WF spot-checks the set given.
//
// args (JSON STRING -- parse defensively):
//   { drops:[ {charge_id, significance, section, summary, close_criterion, evidence_anchor,
//              drop_reason, source} ],            // source: 'trial' | 'polish'
//     consensus_majors:[ {charge_id, section, summary, evidence_anchor, close_criterion} ],
//     units:[ {section_path, section_title, text} ], paper, skeptics }
// Returns { confirmed_drops:[charge_id], revived:[{charge_id, reason, recommend}],
//           spotcheck:[{charge_id, action, reason}] }.

export const meta = {
  name: 'recall-audit',
  description: 'v3 recall: Mode A revives wrongly-dropped charges (bias to revive), Mode B spot-checks strong-consensus valid-fixable majors for correlated-wrong consensus before the edit (sound -> hold, else -> author-required). Fresh skeptics, after trial+polish, before drafter. paperjury review-engine v3.',
  phases: [
    { title: 'Recall', detail: 'fresh skeptics try to revive each dropped charge' },
    { title: 'Spotcheck', detail: 'fresh skeptics stress-test strong-consensus valid majors' },
  ],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const drops = A.drops || []
const consensusMajors = A.consensus_majors || []
const units = A.units || []
const paper = A.paper || ''
const skeptics = Math.max(1, A.skeptics ?? 1)
const ISOLATION = 'Judge ONLY the text quoted in this prompt. Do not read files or search the project; base your judgment solely on what is quoted here.'

const contextText = paper || units.map((u) => `=== ${u.section_path || ''} (${u.section_title || ''}) ===\n${u.text}`).join('\n\n')

const REVIVE = {
  type: 'object', additionalProperties: false,
  properties: { revive: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['revive', 'reason'],
}
const SPOT = {
  type: 'object', additionalProperties: false,
  properties: { sound: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['sound', 'reason'],
}

function revivePrompt(d) {
  return [
    'You are a fresh RECALL AUDITOR (prosecution-side appeal). The charge below was DROPPED.',
    'You did not see the original trial; judge independently from the text. Was the drop WRONG?',
    'Set revive=true if the charge is in fact a real and material flaw that should NOT have been',
    'dropped; revive=false if the drop was correct (it really does not hold or is immaterial).',
    'Recall matters: revive a genuine flaw, but do not revive an immaterial or truly-invalid one.',
    ISOLATION,
    '',
    `DROPPED CHARGE [${d.significance || 'major'}] ${d.section} -- ${d.summary}`,
    d.close_criterion ? `  close_criterion: ${d.close_criterion}` : '',
    `  evidence_anchor: "${d.evidence_anchor}"`,
    `  why it was dropped (${d.source}): ${d.drop_reason}`,
    '', 'THE PAPER:', '"""', contextText, '"""',
  ].filter(Boolean).join('\n')
}

function spotPrompt(m) {
  return [
    'You are a fresh, independent skeptic stress-testing a review verdict BEFORE the paper is',
    'edited. A jury found this charge VALID by a STRONG majority and it is about to be fixed.',
    'Your job is to decorrelate from that consensus: could the agreement be CORRELATED-WRONG?',
    'Set sound=false if EITHER the agreed flaw is actually illusory/overstated on a careful read,',
    'OR the implied fix (the close_criterion) would HARM the paper or misrepresent it. Set',
    'sound=true if the charge and its fix direction genuinely hold up. Be willing to dissent from',
    'the majority; that is the point.',
    ISOLATION,
    '',
    `CONSENSUS CHARGE ${m.section} -- ${m.summary}`,
    m.close_criterion ? `  close_criterion (the planned fix): ${m.close_criterion}` : '',
    `  evidence_anchor: "${m.evidence_anchor}"`,
    (typeof m.reviewer_confidence === 'number' || m.raised_by_count != null)
      ? `  NOTE: raised by ${m.raised_by_count ?? '?'} reviewer(s) at overall_confidence ~${m.reviewer_confidence ?? '?'}/5. LOWER confidence or FEWER raisers means a weaker basis for the consensus -- scrutinize harder for a correlated-wrong agreement.`
      : '',
    '', 'THE PAPER:', '"""', contextText, '"""',
  ].filter(Boolean).join('\n')
}

// Mode A
const recallResults = drops.length
  ? (await parallel(drops.map((d) => () =>
      parallel(Array.from({ length: skeptics }, () => () =>
        agent(revivePrompt(d), { label: `recall:${d.charge_id}`, phase: 'Recall', schema: REVIVE })))
        .then((vs) => {
          const v = vs.filter(Boolean)
          const revived = v.some((x) => x.revive)
          return { drop: d, revived, reason: revived ? v.filter((x) => x.revive).map((x) => x.reason).join(' | ') : null }
        })))).filter(Boolean)
  : []
const revived = recallResults.filter((r) => r.revived).map((r) => ({
  charge_id: r.drop.charge_id, reason: r.reason,
  recommend: r.drop.source === 'trial' ? 'escalate' : 're-trial',
}))
const confirmed_drops = recallResults.filter((r) => !r.revived).map((r) => r.drop.charge_id)

// Mode B (bias: a single skeptic finding the consensus UNSOUND flags it -> author-required)
const spotcheck = consensusMajors.length
  ? (await parallel(consensusMajors.map((m) => () =>
      parallel(Array.from({ length: skeptics }, () => () =>
        agent(spotPrompt(m), { label: `spotcheck:${m.charge_id}`, phase: 'Spotcheck', schema: SPOT })))
        .then((vs) => {
          const v = vs.filter(Boolean)
          const unsound = v.some((x) => x.sound === false)
          return { charge_id: m.charge_id, action: unsound ? 'to-author-required' : 'hold',
            reason: (unsound ? v.filter((x) => x.sound === false) : v).map((x) => x.reason).join(' | ') }
        })))).filter(Boolean)
  : []

log(`recall: ${drops.length} drops -> ${revived.length} revived; ${consensusMajors.length} consensus majors spot-checked -> ${spotcheck.filter((s) => s.action === 'to-author-required').length} flagged to author-required`)
return { confirmed_drops, revived, spotcheck }
