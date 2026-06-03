// meaning-audit.workflow.js -- the semantic half of the spine drift guard.
// The deterministic anchor-diff.js (orchestrator-side) pre-filters to the anchors
// whose support changed or that went missing; this workflow judges ONLY those, in
// parallel, with the four-state verdict, plus one arc-intactness pass over the full
// frozen spine. See references/spine.md and AUTO_MODE_DESIGN §2.
//
// args (delivered by this harness as a JSON STRING -- parse defensively):
//   {
//     anchors: [ { anchor_id, type, frozen_text, baseline_support, current_support,
//                  present_verbatim } ],          // the need_audit set from anchor-diff
//     spine:   [ { anchor_id, type, text } ]       // the full frozen spine, for the arc check
//   }
// Returns { verdicts: [ {anchor_id, verdict, reason, offending_text} ], arc: {arc_intact, reason} }.
// In auto, any verdict other than `holds` rolls back the causing edit and queues it
// (GATING). In review v2 the verdicts are ADVISORY (shown to the human).

export const meta = {
  name: 'meaning-audit',
  description: 'Four-state spine meaning audit: judge each flagged frozen anchor (holds/weakened/contradicted/now-unsupported) + an arc-intactness pass. paperjury engine core.',
  phases: [
    { title: 'Audit', detail: 'one agent per flagged anchor, four-state verdict' },
    { title: 'Arc', detail: 'one agent checks the problem->solution->evidence->resolution arc is unbroken' },
  ],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const anchors = A.anchors || []
const spine = A.spine || []
const ISOLATION = 'Judge ONLY the text quoted in this prompt. Do not read files, search the project, or use any tool to find other context; base your verdict solely on the frozen anchor and the support text quoted here.'

// NOTE: anchor_id is NOT in the agent schema. We fan out one agent per anchor, so
// we KNOW which anchor each result is for and inject the id in code -- never rely on
// an agent to echo an identifier back (it confuses id with type). This pattern
// applies to every per-item workflow in the skill.
const VERDICT = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['holds', 'weakened', 'contradicted', 'now-unsupported'] },
    reason: { type: 'string' },
    offending_text: { type: ['string', 'null'] },
  },
  required: ['verdict', 'reason', 'offending_text'],
}

const ARC = {
  type: 'object', additionalProperties: false,
  properties: {
    arc_intact: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['arc_intact', 'reason'],
}

function auditPrompt(a) {
  return [
    'You are auditing whether a FROZEN anchor sentence of a CS paper still holds',
    'after edits to the text around it. The anchor wording is immutable and was NOT',
    'edited; judge whether the surrounding edits changed what it MEANS or whether it',
    'is still supported.',
    '',
    `Anchor type: ${a.type}`,
    `FROZEN anchor (immutable): "${a.frozen_text}"`,
    a.present_verbatim === false
      ? 'NOTE: the anchor sentence is no longer present verbatim in the current text. '
        + 'Anchors are never supposed to be edited, so treat a vanished/changed anchor as '
        + 'at least `contradicted` unless the current text clearly still asserts the same thing.'
      : '',
    '',
    'BASELINE supporting text (round-0):',
    '"""', a.baseline_support || '(none captured)', '"""',
    '',
    'CURRENT supporting text:',
    '"""', a.current_support || '(anchor not located in current text)', '"""',
    '',
    'Decide ONE verdict:',
    '- holds: still true AND still supported by the current text (a faithful heavy',
    '  rewrite still holds; judge meaning, not surface wording).',
    '- weakened: the anchor\'s commitment is softened (wording or support weaker).',
    '- contradicted: the current text directly conflicts with the anchor.',
    '- now-unsupported: the anchor is still stated, but the evidence that backed it',
    '  was edited away.',
    'If not `holds`, set offending_text to the exact current text that caused it',
    '(else null). Do not inflate a faithful edit into drift; do not rubber-stamp a',
    'real one.',
    ISOLATION,
  ].filter(Boolean).join('\n')
}

function arcPrompt() {
  return [
    'You are checking whether the SPINE of a CS paper still forms one coherent',
    'problem -> solution -> evidence -> resolution arc. Below are the frozen anchor',
    'sentences in order. Decide if the arc is unbroken: does the motivation lead to',
    'the stated gap, the gap to the contribution, the contribution to the method',
    'rationale, and (where present) the results/discussion answer back to the',
    'motivation? Return arc_intact=false ONLY if there is a real break or internal',
    'contradiction across these anchors, with the reason. A partial spine (some',
    'anchors not-yet-written) is fine; judge only the arc among the anchors present.',
    ISOLATION,
    '',
    ...spine.map((s) => `[${s.anchor_id} ${s.type}] ${s.text}`),
  ].join('\n')
}

const verdicts = anchors.length
  ? (await parallel(anchors.map((a) => () =>
      agent(auditPrompt(a), { label: `audit:${a.anchor_id}`, phase: 'Audit', schema: VERDICT })
        .then((v) => (v ? { anchor_id: a.anchor_id, ...v } : null))))).filter(Boolean)
  : []

const arc = spine.length
  ? await agent(arcPrompt(), { label: 'arc', phase: 'Arc', schema: ARC })
  : { arc_intact: true, reason: 'no frozen spine to check' }

const failing = verdicts.filter((v) => v.verdict !== 'holds')
log(`meaning audit: ${verdicts.length} anchors judged, ${failing.length} not-holds; arc_intact=${arc.arc_intact}`)

return { verdicts, arc }
