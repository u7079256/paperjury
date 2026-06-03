// trial.workflow.js -- v3 TRIAL: the 5-tier adjudication (review-engine-v3.md §3.6).
// Per substantive-major charge:
//   DEFENSE (author advocate) gets the WHOLE PAPER -- this recovers the deleted
//     grand-jury's "addressed elsewhere" catch (it scans the whole paper for prior
//     treatment), distilled into the trial.
//   JURY: `jurySize` decorrelated jurors (5 at tier-1) get LOCAL context only (the
//     deterministic anchor-unit + the claim spine + any referenced unit) -- juror-
//     local is the QUALITY choice: focused judgment, less distraction. A juror unsure
//     of its context votes `context-limited` + `need`; the orchestrated expansion loop
//     re-runs it with the requested unit (or the whole paper), capped at `expansionsCap`.
//   JUDGE: the verdict rule is mostly DETERMINISTIC -- decide iff quorum
//     (surviving >= ceil(0.8*jurySize)) AND one side > 60% of SURVIVING votes
//     (context-limited votes do not count). Decided-invalid -> invalid-drop;
//     all-context-limited or undecided-at-tier-12 -> author-required; undecided at
//     tier-1 -> `escalate` (the ORCHESTRATOR re-invokes this WF at jurySize 12).
//     A semantic JUDGE agent runs ONLY on a decided-VALID charge, to route
//     valid-fixable vs author-required and (for valid-fixable) set a close_criterion
//     satisfiable by editing existing text.
//
// Charges are pipelined (a jury fills a wave). Escalation re-batching + the
// idempotent per-charge retry live ORCHESTRATOR-side (review-engine-v3.md §5).
//
// args (JSON STRING -- parse defensively):
//   { charges:[ {charge_id, section, summary, evidence_anchor, significance, kind, references} ],
//     paper:     "the whole manuscript body",         // defense context
//     units:     [ {section_path, section_title, text} ],  // juror local-context source
//     claim_spine:"abstract + intro text",            // always in juror local context
//     spine:     [ {anchor_id, type, text} ],         // frozen anchors (defense may cite drift)
//     jurySize, expansionsCap }                        // 5 (tier-1) | 12 (escalated); cap 2
// Returns [ { charge_id, significance, section, summary, evidence_anchor, verdict,
//             close_criterion, rationale, tally:{valid,invalid,context_limited}, jury_size,
//             escalated, defense, votes } ].

export const meta = {
  name: 'trial',
  description: 'v3 5-tier trial: whole-paper defense -> decorrelated local-context jury (with on-demand context expansion) -> a deterministic quorum/majority verdict + a judge agent that routes a decided-valid charge (valid-fixable vs author-required). Undecided at tier-1 returns escalate (orchestrator re-runs at 12). paperjury review-engine v3.',
  phases: [
    { title: 'Defense', detail: 'author advocate steelmans with WHOLE-PAPER context' },
    { title: 'Jury', detail: 'decorrelated jurors vote on LOCAL context, expand on demand' },
    { title: 'Judgment', detail: 'deterministic quorum/majority; judge agent routes a decided-valid charge' },
  ],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const charges = A.charges || []
const paper = A.paper || ''
const units = A.units || []
const claimSpine = A.claim_spine || ''
const spine = A.spine || []
const jurySize = Math.max(3, A.jurySize ?? 5)
const escalatedIn = A.escalated === true          // orchestrator sets true on the tier-12 re-invocation
const isFinalTier = escalatedIn || jurySize >= 12 // final tier => undecided routes to author-required, not escalate
const expansionsCap = A.expansionsCap ?? 2

const ISOLATION = 'Judge ONLY the text quoted in this prompt. Do not read files or search the project; base your judgment solely on what is quoted here.'

const FRAMINGS = [
  'methodological rigor (is the alleged flaw a real methods problem?)',
  'reproducibility (could the alleged gap actually block reproduction?)',
  'theoretical soundness (does the formalism/argument actually have this flaw?)',
  'baseline fairness and empirical rigor (is the empirical complaint fair and correct?)',
  'claims-vs-evidence (does the paper overclaim relative to what it shows here?)',
  'novelty and prior art (is the charge about novelty well-founded?)',
  'statistical validity (is the statistical concern real and material?)',
  'writing clarity and precision (is the clarity/notation charge real, not pedantic?)',
  'scope and venue fit (in scope for this venue, or out-of-scope nitpicking?)',
  'practical and deployment realism (is the practicality charge grounded?)',
  'adversarial competitor: read the paper in the MOST hostile reasonable way; is the charge valid?',
  'charitable peer: read the paper in the MOST charitable way that still respects the evidence; is it still valid?',
]

// Pick `n` decorrelated framings that ALWAYS include the two-way decorrelators (the
// most-hostile #10 and most-charitable #11), even at tier-5 where a naive slice(0,5)
// would omit them (spec §3.6 wants both at every tier).
function framingsFor(n) {
  if (n >= FRAMINGS.length) return FRAMINGS.slice()
  const core = FRAMINGS.slice(0, Math.max(0, n - 2))
  return [...core, FRAMINGS[10], FRAMINGS[11]].slice(0, n)
}

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
    vote: { type: 'string', enum: ['valid', 'invalid', 'context-limited'] },
    reason: { type: 'string' },
    need: { type: 'string' },
  },
  required: ['vote', 'reason', 'need'],
}
const ROUTE = {
  type: 'object', additionalProperties: false,
  properties: {
    route: { type: 'string', enum: ['valid-fixable', 'author-required'] },
    close_criterion: { type: ['string', 'null'] },
    rationale: { type: 'string' },
  },
  required: ['route', 'close_criterion', 'rationale'],
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const spineText = spine.length ? spine.map((s) => `[${s.anchor_id} ${s.type}] ${s.text}`).join('\n') : '(no frozen spine)'

// Deterministic local-context selection for a charge.
function unitText(u) { return `=== ${u.section_path || ''} ${u.section_title ? '(' + u.section_title + ')' : ''} ===\n${u.text}` }
function anchorUnit(c) {
  const a = norm(c.evidence_anchor)
  return (a && units.find((u) => norm(u.text).includes(a)))
    || units.find((u) => norm(u.section_title) === norm(c.section) || norm(u.section_path) === norm(c.section))
    || units[0]
}
function refUnits(c) {
  const refs = norm(c.references)
  if (!refs) return []
  // exact token match on section_path (so "3" does not match "3.2"); length-guarded
  // contains on the multi-word section_title (less prone to spurious matches).
  const tokens = new Set(refs.split(/[^a-z0-9.]+/i).filter(Boolean))
  return units.filter((u) => {
    const t = norm(u.section_title), p = norm(u.section_path)
    return (p && tokens.has(p)) || (t && t.length > 4 && refs.includes(t))
  })
}
function baseContext(c) {
  const parts = []
  if (claimSpine) parts.push('=== claim spine (abstract/intro) ===\n' + claimSpine)
  const au = anchorUnit(c)
  if (au) parts.push(unitText(au))
  for (const ru of refUnits(c)) if (ru !== au) parts.push(unitText(ru))
  return { text: parts.join('\n\n'), names: units.map((u) => u.section_title || u.section_path).filter(Boolean) }
}
function expandContext(prev, need, c) {
  const want = norm(need)
  const match = units.find((u) => {
    const t = norm(u.section_title), p = norm(u.section_path)
    return (t && want.includes(t)) || (p && want.includes(p))
  })
  if (match && !prev.includes(unitText(match))) return prev + '\n\n' + unitText(match)
  // could not target the request -> give the whole paper (cheap for a short CS paper)
  return 'WHOLE PAPER:\n' + paper
}

function defensePrompt(c) {
  return [
    'You are the DEFENSE (the author\'s advocate) in a per-issue review trial. You have the',
    'WHOLE paper. Steelman it against ONE charge WITH EVIDENCE. Crucially, SCAN THE WHOLE',
    'PAPER for whether the charge is already addressed elsewhere (a different section, a',
    'footnote, the appendix-in-text). Pick grounds: addressed-in-text (cite WHERE),',
    'out-of-scope (name the norm), would-drift-anchor (name the frozen anchor a fix harms),',
    'severity-overstated, or charge-stands (concede). Be honest.',
    ISOLATION,
    '',
    `CHARGE [${c.significance}] ${c.section} -- ${c.summary}`,
    `  evidence_anchor: "${c.evidence_anchor}"`,
    c.references ? `  references: ${c.references}` : '',
    '',
    'FROZEN SPINE (a fix must not drift these):', spineText,
    '', 'THE WHOLE PAPER:', '"""', paper, '"""',
  ].filter(Boolean).join('\n')
}

function jurorPrompt(c, defense, framing, context) {
  return [
    'You are a TRIAL JUROR deciding whether the paper is GUILTY of one alleged flaw (is the',
    'charge VALID). You hear BOTH sides. Judge from THIS framing:',
    `  ${framing}`,
    'Vote `valid` (the paper really has this flaw), `invalid` (it does not), or',
    '`context-limited` if you genuinely cannot decide from the context shown -- in that case',
    'set `need` to the exact section/material you need (else need=""). Do not guess on missing',
    'context; do not convict on a weak charge or acquit a real flaw because the defense is glib.',
    ISOLATION,
    '',
    `CHARGE [${c.significance}] ${c.section} -- ${c.summary}`,
    `  evidence_anchor: "${c.evidence_anchor}"`,
    '',
    `DEFENSE (grounds: ${defense.grounds}): ${defense.defense}`,
    '',
    'CONTEXT (the relevant parts of the paper):', '"""', context, '"""',
  ].join('\n')
}

function routePrompt(c, defense, votes, tally) {
  return [
    'You are the PRESIDING JUDGE. The jury found this charge VALID by a clear majority. You',
    'do NOT re-litigate validity. ROUTE it:',
    '- valid-fixable: it can be closed by EDITING EXISTING TEXT (reword, restrict/soften a',
    '  claim to match the evidence, surface info already present). Set close_criterion = one',
    '  sentence an editor can satisfy with NO new experiment, measurement, number, or citation.',
    '- author-required: closing it needs NEW data/experiment/number/citation or author-private',
    '  intent. Set close_criterion = null. (If it could be closed EITHER by new data OR by an',
    '  honest text-only softening, PREFER the text-only fix and route valid-fixable.)',
    ISOLATION,
    '',
    `Jury: ${tally.valid} valid / ${tally.invalid} invalid / ${tally.context_limited} context-limited.`,
    `CHARGE [${c.significance}] ${c.section} -- ${c.summary}`,
    `  evidence_anchor: "${c.evidence_anchor}"`,
    `DEFENSE (grounds: ${defense.grounds}): ${defense.defense}`,
    '', 'JUROR REASONS:',
    votes.map((v, i) => `  J${i + 1} [${v.vote}]: ${v.reason}`).join('\n'),
  ].join('\n')
}

async function runJuror(c, defense, framing, base) {
  let context = base.text || ('WHOLE PAPER:\n' + paper)
  let v = await agent(jurorPrompt(c, defense, framing, context), { label: `jury:${c.charge_id}`, phase: 'Jury', schema: VOTE })
  let exp = 0
  while (v && v.vote === 'context-limited' && exp < expansionsCap) {
    exp++
    context = expandContext(context, v.need, c)
    v = await agent(jurorPrompt(c, defense, framing, context), { label: `jury:${c.charge_id}:exp${exp}`, phase: 'Jury', schema: VOTE })
  }
  return v
}

const results = await pipeline(
  charges,
  // 1. defense (whole paper)
  (c) => agent(defensePrompt(c), { label: `defense:${c.charge_id}`, phase: 'Defense', schema: DEFENSE }),
  // 2. jury (decorrelated, local context + on-demand expansion)
  (defense, c) => {
    if (!defense) return null
    const framings = framingsFor(jurySize)
    const base = baseContext(c)
    return parallel(framings.map((f) => () => runJuror(c, defense, f, base)))
      .then((vs) => ({ defense, votes: vs.filter(Boolean) }))
  },
  // 3. judgment (deterministic verdict; judge agent only routes a decided-valid charge)
  async (jr, c) => {
    if (!jr || !jr.votes.length) return null
    const tally = {
      valid: jr.votes.filter((v) => v.vote === 'valid').length,
      invalid: jr.votes.filter((v) => v.vote === 'invalid').length,
      context_limited: jr.votes.filter((v) => v.vote === 'context-limited').length,
    }
    const surviving = tally.valid + tally.invalid
    const quorum = Math.ceil(0.8 * jurySize)
    const base = { charge_id: c.charge_id, significance: c.significance, section: c.section, summary: c.summary,
      evidence_anchor: c.evidence_anchor, tally, jury_size: jurySize, escalated: escalatedIn, defense: jr.defense, votes: jr.votes }

    if (surviving === 0) {
      return { ...base, verdict: 'author-required', close_criterion: null, rationale: 'all jurors context-limited; needs a human judgment.' }
    }
    const decided = surviving >= quorum
    const validFrac = tally.valid / surviving
    const invalidFrac = tally.invalid / surviving
    if (decided && invalidFrac > 0.6) {
      return { ...base, verdict: 'invalid-drop', close_criterion: null, rationale: `jury ${tally.invalid}/${surviving} invalid (quorum ${quorum}).` }
    }
    if (decided && validFrac > 0.6) {
      const j = await agent(routePrompt(c, jr.defense, jr.votes, tally), { label: `judge:${c.charge_id}`, phase: 'Judgment', schema: ROUTE })
      if (!j) return { ...base, verdict: 'author-required', close_criterion: null, rationale: 'valid by jury; routing agent unavailable -> author-required.' }
      const route = (j.route === 'valid-fixable' && j.close_criterion && String(j.close_criterion).trim()) ? 'valid-fixable' : (j.route === 'valid-fixable' ? 'author-required' : j.route)
      return { ...base, verdict: route, close_criterion: route === 'valid-fixable' ? j.close_criterion : null, rationale: j.rationale }
    }
    // no clear majority
    if (isFinalTier) {
      return { ...base, verdict: 'author-required', close_criterion: null, rationale: `no clear majority at tier-12 (${tally.valid}/${tally.invalid}/${tally.context_limited}); needs a human call.` }
    }
    return { ...base, verdict: 'escalate', close_criterion: null, rationale: `no clear majority at tier-${jurySize} (${tally.valid}/${tally.invalid}/${tally.context_limited}); escalate to 12.` }
  }
)

const out = results.filter(Boolean)
const by = {}
out.forEach((r) => { by[r.verdict] = (by[r.verdict] || 0) + 1 })
log(`trial @${jurySize}: ${out.length}/${charges.length} judged -> ${JSON.stringify(by)}`)

return out
