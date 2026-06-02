// reading-check.workflow.js -- v2 PROSECUTION: charge generation.
// The first stage of review-engine v2 (REVIEW_ENGINE_V2_DESIGN §3-4). Each lens
// close-reads each UNIT (decompose.js gives the units inline) and FILES CHARGES
// (issue + severity + close_criterion + an exact evidence quote), then rests. One
// cross-unit agent catches inconsistencies no single-unit reader can see (notation
// clash across sections, abstract-vs-results, claim-vs-evidence). Loop-until-dry
// raises recall. NO adversarial verify here -- that is the grand-jury screen + the
// trial downstream; the prosecution only charges.
//
// Decompose -> one agent per (unit x lens) so deep reading is cheap and every
// sentence is actually read (treats "not reading carefully", REVIEW_ENGINE_V2 §5).
// A deterministic quote-verify tags any charge whose evidence quote is not actually
// in the text (a hallucination tell the screen/trial then weigh).
//
// args (delivered as a JSON STRING -- parse defensively):
//   { mode, venueProfile,
//     units:    [ { unit_id, section, text } ],     // from decompose.js (units)
//     personas: [ { id, lensName, personaPrompt } ],// the reading lenses (3/3/4 by intensity)
//     dryStop, maxReadRounds }                       // recall dials
// Returns { charges:[...], rounds_run, dropped_no_criterion, per_round }.

export const meta = {
  name: 'reading-check',
  description: 'v2 prosecution: per-(unit x lens) close-read files charges with an exact evidence quote, plus a cross-unit consistency pass, loop-until-dry. No verify (the trial does that). paper-review-loop review-engine v2.',
  phases: [
    { title: 'Read', detail: 'one agent per (unit x lens) files charges with an evidence quote' },
    { title: 'CrossUnit', detail: 'one agent reads all units for cross-section inconsistencies' },
    { title: 'Merge', detail: 'dedupe within the pass and against everything seen; quote-verify' },
  ],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const units = A.units || []
const personas = A.personas || []
const dryStop = A.dryStop ?? 2
const maxReadRounds = A.maxReadRounds ?? 3
const venueProfile = A.venueProfile || '(unspecified venue)'
const mode = A.mode || 'full'
const ISOLATION = 'Judge ONLY the text quoted in this prompt. Do not read files, search the project, or use any tool to find other context (other sections, the ledger, prior rounds, or any real manuscript on disk); base your work solely on what is quoted here.'

const CHARGES = {
  type: 'object', additionalProperties: false,
  properties: {
    charges: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          section: { type: 'string' },
          summary: { type: 'string' },
          close_criterion: { type: 'string' },
          evidence_anchor: { type: 'string' },
        },
        required: ['severity', 'section', 'summary', 'close_criterion', 'evidence_anchor'],
      },
    },
  },
  required: ['charges'],
}

const MERGE = {
  type: 'object', additionalProperties: false,
  properties: {
    new_charges: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          section: { type: 'string' },
          summary: { type: 'string' },
          close_criterion: { type: 'string' },
          evidence_anchor: { type: 'string' },
          raised_by: { type: 'array', items: { type: 'string' } },
        },
        required: ['severity', 'section', 'summary', 'close_criterion', 'evidence_anchor', 'raised_by'],
      },
    },
    dropped_no_criterion: {
      type: 'array',
      items: { type: 'object', additionalProperties: false,
        properties: { summary: { type: 'string' }, reason: { type: 'string' } },
        required: ['summary', 'reason'] },
    },
  },
  required: ['new_charges', 'dropped_no_criterion'],
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()

function readPrompt(unit, p) {
  return [
    p.personaPrompt,
    '',
    `Your lens: ${p.lensName}. Cover the full review surface; the lens is a tendency, not a fence.`,
    `Venue style profile:\n${venueProfile}`,
    `Review mode: ${mode}.`,
    '',
    'You are the PROSECUTION in a per-issue review. Close-read the unit below and',
    'FILE CHARGES: each is a concrete alleged flaw. For each charge give severity, a',
    'precise section anchor, a one-line summary, a concrete close_criterion (one',
    'sentence an edit must satisfy), and evidence_anchor = an EXACT VERBATIM QUOTE',
    'from the unit that the charge rests on (copy it character-for-character; do not',
    'paraphrase). Read every sentence. Do not invent flaws to look thorough and do',
    'not soften real ones. You only charge here; you will not defend or judge.',
    ISOLATION,
    '',
    `THE UNIT (section: ${unit.section}); all you may judge:`,
    '"""', unit.text, '"""',
  ].join('\n')
}

function crossUnitPrompt() {
  return [
    'You are the PROSECUTION doing a CROSS-UNIT consistency pass over a CS paper.',
    `Venue style profile:\n${venueProfile}`,
    '',
    'Read all units below and file charges ONLY for issues that span units and that a',
    'single-unit reader cannot see: a symbol/notation used inconsistently across',
    'sections, an abstract/intro claim not matched by the results, a contribution the',
    'experiments do not validate, a method element never evaluated. For each charge',
    'give severity, section anchor (name the units involved), summary, close_criterion,',
    'and evidence_anchor = an exact verbatim quote from one of the units.',
    ISOLATION,
    '',
    units.map((u) => `=== UNIT ${u.unit_id} (${u.section}) ===\n${u.text}`).join('\n\n'),
  ].join('\n')
}

function mergePrompt(reviews, seen) {
  return [
    'You merge one pass of the prosecution. Input: each reviewer\'s charges (JSON),',
    'plus a SEEN list of charge summaries already captured in earlier passes.',
    'Rules:',
    '- Dedupe within this pass: charges raised by >=2 reviewers collapse into ONE',
    '  whose raised_by lists every source. Same charge only when the section anchor',
    '  matches AND the summaries/criteria genuinely overlap; when unsure keep separate.',
    '- Exclude anything already in SEEN (judge by meaning). Only return genuinely NEW',
    '  charges this pass.',
    '- Drop any charge missing a usable close_criterion into dropped_no_criterion.',
    '- Preserve each charge\'s evidence_anchor quote verbatim. Do NOT invent charges.',
    ISOLATION,
    '',
    'SEEN (do not re-report):', JSON.stringify(seen, null, 2),
    '', 'Charges this pass:', JSON.stringify(reviews, null, 2),
  ].join('\n')
}

// deterministic quote-verify: is the evidence quote actually in some unit?
const allText = norm(units.map((u) => u.text).join('\n'))
function quoteVerified(q) {
  const nq = norm(q)
  return nq.length > 0 && allText.includes(nq)
}

const confirmed = []
const seen = []
const droppedNoCriterion = []
const perRound = []
let dry = 0, round = 0

while (dry < dryStop && round < maxReadRounds) {
  round++
  if (budget.total && budget.remaining() < 40000) { log(`budget low; stop at round ${round}`); break }

  // unit x lens, plus one cross-unit agent, all in the Read/CrossUnit phases
  const jobs = []
  for (const u of units) for (const p of personas) {
    jobs.push(() => agent(readPrompt(u, p), { label: `r${round}:read:${u.unit_id}:${p.id}`, phase: 'Read', schema: CHARGES })
      .then((r) => (r ? { reviewer: `${p.id}@${u.unit_id}`, charges: r.charges } : null)))
  }
  if (units.length > 1) {
    jobs.push(() => agent(crossUnitPrompt(), { label: `r${round}:crossunit`, phase: 'CrossUnit', schema: CHARGES })
      .then((r) => (r ? { reviewer: 'cross-unit', charges: r.charges } : null)))
  }
  const reviews = (await parallel(jobs)).filter(Boolean)

  const merge = await agent(mergePrompt(reviews, seen), { label: `r${round}:merge`, phase: 'Merge', schema: MERGE })
  droppedNoCriterion.push(...(merge.dropped_no_criterion || []))
  const fresh = (merge.new_charges || [])
  if (fresh.length === 0) { dry++; perRound.push({ round, fresh: 0, dry, quote_unverified: 0 }); log(`pass ${round}: no new charges (dry ${dry}/${dryStop})`); continue }
  fresh.forEach((c) => { seen.push(c.summary); c.quote_verified = quoteVerified(c.evidence_anchor) })
  confirmed.push(...fresh)
  dry = 0
  perRound.push({ round, fresh: fresh.length, dry, quote_unverified: fresh.filter((c) => !c.quote_verified).length })
  log(`pass ${round}: ${fresh.length} new charges (${fresh.filter((c) => !c.quote_verified).length} with unverified quotes), total ${confirmed.length}`)
}

const rank = { blocker: 0, major: 1, minor: 2, nit: 3 }
const charges = confirmed
  .slice().sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
  .map((c, i) => ({ ...c, charge_id: 'C-' + String(i + 1).padStart(2, '0') }))

return { charges, rounds_run: round, dropped_no_criterion: droppedNoCriterion, per_round: perRound }
