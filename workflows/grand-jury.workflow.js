// grand-jury.workflow.js -- v2 Tier-1 SCREEN (REVIEW_ENGINE_V2_DESIGN §2-3).
// A CHEAP, one-sided, LOW-BAR probable-cause screen. It drops ONLY the obviously
// invalid (a hallucinated/false premise, something plainly already handled, clearly
// out of scope) and passes everything non-obvious to trial. The low bar is what
// protects RECALL: when in doubt, indict (pass to trial). A deliberative body here
// would be cost without function, so the agents are LIGHT (Haiku) and few (1-3 by
// intensity). The deterministic premise check (is the evidence quote real?) already
// ran in reading-check (quote_verified); a false quote is a strong signal here but
// not an automatic drop (the agent still reads the text).
//
// Bias-to-indict made precise: a charge is dropped ONLY if ALL screen agents agree
// it is obviously invalid (unanimous). Any single "send to trial" keeps it.
//
// args (JSON STRING -- parse defensively):
//   { charges:[ {charge_id, severity, section, summary, close_criterion, evidence_anchor, quote_verified} ],
//     units:[ {unit_id, section, text} ],   // text for grounding
//     screenAgents }                         // 1 | 2 | 3 by intensity
// Returns { screened:[charges to try], dropped_obvious:[{charge_id, reason}] }.

export const meta = {
  name: 'grand-jury',
  description: 'v2 Tier-1 cheap low-bar screen: drop only the obviously-invalid charges (unanimous among light agents), pass everything non-obvious to trial. Bias-to-indict protects recall. paper-review-loop review-engine v2.',
  phases: [{ title: 'Screen', detail: 'light Haiku agents give a probable-cause verdict per charge; drop only on unanimous obvious-invalid' }],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const charges = A.charges || []
const units = A.units || []
const screenAgents = Math.max(1, A.screenAgents ?? 2)
const ISOLATION = 'Judge ONLY the text quoted in this prompt. Do not read files, search the project, or use any tool to find other context; base your verdict solely on what is quoted here.'

const SCREEN = {
  type: 'object', additionalProperties: false,
  properties: {
    obviously_invalid: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['obviously_invalid', 'reason'],
}

const contextText = units.map((u) => `=== ${u.unit_id} (${u.section}) ===\n${u.text}`).join('\n\n')

function screenPrompt(c) {
  return [
    'You are a GRAND JUROR doing a CHEAP, LOW-BAR probable-cause screen of one charge',
    'against a CS paper. Your ONLY job: is this charge OBVIOUSLY invalid? It is',
    'obviously invalid only if one of these is plainly true from the text:',
    '- the premise is false (the thing it claims is wrong is actually correct/present),',
    '- it is plainly already addressed elsewhere in the text,',
    '- it is clearly out of scope for the venue.',
    'BIAS TO INDICT: if there is any real question, it is NOT obviously invalid -- send',
    'it to trial. Only set obviously_invalid=true when it is beyond reasonable doubt a',
    'non-issue. Do not weigh severity or how fixable it is; that is the trial\'s job.',
    ISOLATION,
    c.quote_verified === false
      ? 'NOTE: this charge\'s evidence quote was NOT found verbatim in the text (possible'
        + ' misquote); weigh that, but verify against the text yourself before dropping.'
      : '',
    '',
    `CHARGE: [${c.severity}] ${c.section} -- ${c.summary}`,
    `  close_criterion: ${c.close_criterion}`,
    `  evidence_anchor (claimed quote): "${c.evidence_anchor}"`,
    '',
    'THE PAPER TEXT:',
    '"""', contextText, '"""',
  ].filter(Boolean).join('\n')
}

const results = (await parallel(charges.map((c) => () =>
  parallel(Array.from({ length: screenAgents }, () => () =>
    agent(screenPrompt(c), { label: `screen:${c.charge_id}`, phase: 'Screen', schema: SCREEN, model: 'haiku' })))
    .then((vs) => {
      const v = vs.filter(Boolean)
      const invalidCount = v.filter((x) => x.obviously_invalid).length
      // unanimous obvious-invalid -> drop; else send to trial (bias-to-indict)
      const drop = v.length > 0 && invalidCount === v.length
      return { charge: c, drop, reason: drop ? (v.map((x) => x.reason).join(' | ')) : null }
    })
))).filter(Boolean)

const screened = results.filter((r) => !r.drop).map((r) => r.charge)
const dropped_obvious = results.filter((r) => r.drop).map((r) => ({ charge_id: r.charge.charge_id, reason: r.reason }))

log(`grand jury: ${charges.length} charges -> ${screened.length} to trial, ${dropped_obvious.length} dropped as obviously invalid`)

return { screened, dropped_obvious }
