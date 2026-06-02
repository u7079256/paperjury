// trial.workflow.js -- v2 TRIAL: the Tier-2 verdict body (REVIEW_ENGINE_V2 §2-4).
// Per screened charge: DEFENSE (author agent steelmans the paper WITH evidence) ->
// a DECORRELATED trial jury votes on VALIDITY hearing both sides -> the presiding
// JUDGE enters judgment by the three-way routing:
//   invalid-drop    jury majority finds the charge invalid           -> recall audit
//   valid-fixable   majority valid AND decidable-from-text AND safe   -> drafter (set close_criterion)
//   author-required valid but needs author-private info / a judgment  -> queue / 2nd instance
//                   call, OR the jury is split/uncertain
// Charges are pipelined (NOT barriered): a 12-juror jury fills one 16-wide wave, so
// trials serialize across charges while a charge's defense/judge use spare slots
// (REVIEW_ENGINE_V2 §7). The jury is worth its size ONLY if DECORRELATED, so each
// juror gets a distinct framing (incl. one maximally hostile and one maximally
// charitable, to decorrelate both ways).
//
// args (JSON STRING -- parse defensively):
//   { charges:[ {charge_id, severity, section, summary, close_criterion, evidence_anchor} ],
//     units:[ {unit_id, section, text} ],
//     spine:[ {anchor_id, type, text} ],   // so the defense can argue "fixing it drifts anchor A4"
//     jurySize }                            // 6 | 9 | 12 by intensity
// Returns [ { charge_id, verdict, close_criterion, rationale, tally:{valid,invalid}, defense, votes } ].

export const meta = {
  name: 'trial',
  description: 'v2 trial: per charge, defense steelman -> decorrelated jury validity vote -> presiding judge enters the three-way routing (invalid-drop / valid-fixable / author-required). Pipelined across charges. paper-review-loop review-engine v2.',
  phases: [
    { title: 'Defense', detail: 'author agent steelmans the paper against the charge, with evidence' },
    { title: 'Jury', detail: 'decorrelated jurors vote on validity hearing both sides' },
    { title: 'Judgment', detail: 'presiding judge tallies and enters the three-way routing' },
  ],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const charges = A.charges || []
const units = A.units || []
const spine = A.spine || []
const jurySize = Math.max(3, A.jurySize ?? 12)
const ISOLATION = 'Judge ONLY the text quoted in this prompt. Do not read files, search the project, or use any tool to find other context (other sections, the ledger, prior rounds, or any real manuscript on disk); base your judgment solely on what is quoted here.'

const FRAMINGS = [
  'methodological rigor (is the alleged flaw a real methods problem?)',
  'reproducibility (could the alleged gap actually block reproduction?)',
  'theoretical soundness (does the formalism/argument actually have this flaw?)',
  'baseline fairness and empirical rigor (is the empirical complaint fair and correct?)',
  'claims-vs-evidence (does the paper actually overclaim relative to what it shows here?)',
  'novelty and prior art (is the charge about novelty well-founded?)',
  'statistical validity (is the statistical concern real and material?)',
  'writing clarity and precision (is the clarity/notation charge real, not pedantic?)',
  'scope and venue fit (is the charge in scope for this venue, or is it out-of-scope nitpicking?)',
  'practical and deployment realism (is the practicality charge grounded?)',
  'adversarial competitor: read the paper in the MOST hostile reasonable way; is the charge valid?',
  'charitable peer: read the paper in the MOST charitable way that still respects the evidence; is the charge still valid?',
]

const DEFENSE = {
  type: 'object', additionalProperties: false,
  properties: {
    defense: { type: 'string' },
    grounds: { type: 'string', enum: ['addressed-in-text', 'out-of-scope', 'would-drift-anchor', 'severity-overstated', 'charge-stands'] },
  },
  required: ['defense', 'grounds'],
}
const VOTE = {
  type: 'object', additionalProperties: false,
  properties: {
    vote: { type: 'string', enum: ['valid', 'invalid'] },
    reason: { type: 'string' },
  },
  required: ['vote', 'reason'],
}
const JUDGMENT = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['invalid-drop', 'valid-fixable', 'author-required'] },
    close_criterion: { type: ['string', 'null'] },
    rationale: { type: 'string' },
  },
  required: ['verdict', 'close_criterion', 'rationale'],
}

const contextText = units.map((u) => `=== ${u.unit_id} (${u.section}) ===\n${u.text}`).join('\n\n')
const spineText = spine.length ? spine.map((s) => `[${s.anchor_id} ${s.type}] ${s.text}`).join('\n') : '(no frozen spine)'

function defensePrompt(c) {
  return [
    'You are the DEFENSE (the author\'s advocate) in a per-issue review trial. Steelman',
    'the paper against ONE charge, WITH EVIDENCE. A bare "it is fine" does not count;',
    'you must ground the defense in the text, a venue norm, or the spine. Pick the',
    'grounds: addressed-in-text (cite where), out-of-scope (name the norm),',
    'would-drift-anchor (name which frozen anchor a fix would damage), severity-overstated,',
    'or charge-stands (concede the charge is valid). Be honest: do not defend an',
    'indefensible charge, but do not concede a real defense.',
    ISOLATION,
    '',
    `CHARGE: [${c.severity}] ${c.section} -- ${c.summary}`,
    `  close_criterion: ${c.close_criterion}`,
    `  evidence_anchor: "${c.evidence_anchor}"`,
    '',
    'FROZEN SPINE (anchors a fix must not drift):', spineText,
    '', 'THE PAPER TEXT:', '"""', contextText, '"""',
  ].join('\n')
}

function jurorPrompt(c, defense, framing) {
  return [
    'You are a TRIAL JUROR deciding whether the paper is GUILTY of one alleged flaw',
    '(i.e. whether the charge is VALID). You hear BOTH sides. Judge from THIS framing:',
    `  ${framing}`,
    'Vote `valid` if the charge holds (the paper really has this flaw) or `invalid` if',
    'it does not, with a reason grounded in the evidence and the defense. Judge only',
    'this charge; do not open new issues. Be fair: do not convict on a weak charge,',
    'do not acquit a real flaw because the defense is glib.',
    ISOLATION,
    '',
    `CHARGE: [${c.severity}] ${c.section} -- ${c.summary}`,
    `  close_criterion: ${c.close_criterion}`,
    `  evidence_anchor: "${c.evidence_anchor}"`,
    '',
    `DEFENSE (grounds: ${defense.grounds}): ${defense.defense}`,
    '', 'THE PAPER TEXT:', '"""', contextText, '"""',
  ].join('\n')
}

function judgePrompt(c, defense, votes, tally) {
  return [
    'You are the PRESIDING JUDGE. You do NOT vote. Given the charge, the defense, and',
    'the jury\'s votes, ENTER judgment by the routing rules:',
    '- invalid-drop: the jury majority finds the charge invalid.',
    '- valid-fixable: the majority finds it valid AND the charge can be closed by',
    '  EDITING THE EXISTING TEXT (rewording, restricting or softening a claim to match',
    '  the evidence, surfacing information already present). The close_criterion you set',
    '  MUST be satisfiable by an editor with NO new experiments, measurements, numbers,',
    '  or citations. NEVER set a close_criterion that asks for a new ablation/experiment',
    '  /result under valid-fixable -- that is author-required.',
    '- author-required: the charge is valid but closing it needs a NEW experiment,',
    '  measurement, number, or citation, or author-private design intent, OR the jury is',
    '  split/uncertain. Set close_criterion to null. (If a valid charge could be closed',
    '  EITHER by new data OR by an honest text-only softening of the claim, prefer the',
    '  text-only fix and route valid-fixable with that softening as the close_criterion.)',
    'Give a short rationale; if the jury was split, say so.',
    ISOLATION,
    '',
    `Jury tally: ${tally.valid} valid / ${tally.invalid} invalid (of ${votes.length}).`,
    `CHARGE: [${c.severity}] ${c.section} -- ${c.summary}`,
    `  prosecution close_criterion: ${c.close_criterion}`,
    `DEFENSE (grounds: ${defense.grounds}): ${defense.defense}`,
    '',
    'JUROR REASONS:',
    votes.map((v, i) => `  J${i + 1} [${v.vote}]: ${v.reason}`).join('\n'),
  ].join('\n')
}

const results = await pipeline(
  charges,
  // stage 1: defense
  (c) => agent(defensePrompt(c), { label: `defense:${c.charge_id}`, phase: 'Defense', schema: DEFENSE }),
  // stage 2: jury (decorrelated), hearing the defense
  (defense, c) => {
    if (!defense) return null
    const framings = FRAMINGS.slice(0, jurySize)
    return parallel(framings.map((f) => () =>
      agent(jurorPrompt(c, defense, f), { label: `jury:${c.charge_id}`, phase: 'Jury', schema: VOTE })))
      .then((vs) => ({ defense, votes: vs.filter(Boolean) }))
  },
  // stage 3: judgment
  (jr, c) => {
    if (!jr || !jr.votes.length) return null
    const tally = { valid: jr.votes.filter((v) => v.vote === 'valid').length, invalid: jr.votes.filter((v) => v.vote === 'invalid').length }
    return agent(judgePrompt(c, jr.defense, jr.votes, tally), { label: `judge:${c.charge_id}`, phase: 'Judgment', schema: JUDGMENT })
      .then((j) => (j ? { charge_id: c.charge_id, severity: c.severity, section: c.section, summary: c.summary,
        evidence_anchor: c.evidence_anchor, verdict: j.verdict, close_criterion: j.close_criterion,
        rationale: j.rationale, tally, defense: jr.defense, votes: jr.votes } : null))
  }
)

const out = results.filter(Boolean)
const by = { 'invalid-drop': 0, 'valid-fixable': 0, 'author-required': 0 }
out.forEach((r) => { by[r.verdict]++ })
log(`trials: ${out.length}/${charges.length} judged -> invalid-drop ${by['invalid-drop']}, valid-fixable ${by['valid-fixable']}, author-required ${by['author-required']}`)

return out
