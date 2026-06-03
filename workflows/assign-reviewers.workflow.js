// assign-reviewers.workflow.js -- v3 reviewer ASSIGNMENT (review-engine-v3.md §3.1).
// A program chair assigns reviewers whose expertise matches the paper's subfields; v3
// mirrors that. One agent reads the whole paper, names the N most relevant subfields,
// and writes a template-constrained DOMAIN OVERLAY per slot; the persona_prompt =
// project-provided gatekeeper CORE + that overlay (+ the venue profile is added by
// reading-check). reviewer_id (R1..RN) is assigned in CODE, never echoed by an agent.
//
// HEADLESS DEGRADE (never block): a config-pinned reviewer set wins outright. Else an
// optional verifier (cap-1) re-derives the top subfields and checks each assigned
// domain is on-topic; a slot it cannot confirm degrades to a GENERIC gatekeeper and is
// listed in assignment_unverified (a ledger.meta field). One bad slot never degrades
// the whole panel. The human PRE-FLIGHT gate (review mode) sees any degrade; it runs
// BEFORE the loop (AskUserQuestion is dead in-loop) and is the orchestrator's job.
//
// args (JSON STRING -- parse defensively):
//   { paper, N, venueProfile, personaCore,
//     configReviewers: null | [ { reviewer_id, domain, persona_prompt } ],   // config-pin
//     verify: bool }
// Returns { reviewers:[ {reviewer_id, domain, persona_prompt} ], assignment_unverified:[id], subfields:[..] }.

export const meta = {
  name: 'assign-reviewers',
  description: 'v3 assignment: read the paper, name N subfields, instantiate N domain reviewers from the project gatekeeper persona core; config-pin wins; an optional verifier degrades an unconfirmable slot to a generic reviewer (never blocks). paperjury review-engine v3.',
  phases: [
    { title: 'Assign', detail: 'one agent names N subfields + writes a domain overlay per slot' },
    { title: 'Verify', detail: 'optional cap-1 per-slot on-topic check; degrade an unconfirmable slot' },
  ],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const paper = A.paper || ''
const N = Math.max(2, Math.min(4, A.N ?? 3))
const venueProfile = A.venueProfile || '(unspecified venue)'
const configReviewers = Array.isArray(A.configReviewers) ? A.configReviewers : null
const verify = A.verify !== false   // default on

// Generic fallback gatekeeper core (used only if the project provides none). The skill
// stays generic: a real project passes its own persona core via config.
const DEFAULT_CORE = [
  'You are a senior reviewer for a top CS conference, known for being harsh, precise, and',
  'constructive. Your job is to find what is actually wrong, not to be agreeable. You',
  'separate fatal flaws from fixable nits and weight them accordingly. You do not pad with',
  'compliments, you do not invent problems to look thorough, and you do not soften a real',
  'flaw. You judge the paper on its actual merit. Two passes: first a blunt list of candidate',
  'fatal flaws (unsupported central claims, unfair/missing baselines, ablations that miss key',
  'design decisions, overclaims, internal contradictions, a contribution the experiments do',
  'not validate); then a forensic interrogation of each (where exactly, why it is a flaw,',
  'what evidence would settle it, fatal or fixable).',
].join('\n')
const personaCore = (A.personaCore && String(A.personaCore).trim()) ? A.personaCore : DEFAULT_CORE

const ISOLATION = 'Work ONLY from the manuscript quoted here. Do not read files or search the project.'

function buildPersona(domain, overlay) {
  return [personaCore, '', `Your expert domain: ${domain}.`, 'Domain sensitivities (what this background makes you especially alert to):', overlay].join('\n')
}

// config-pin: return as-is (still allow a venue/core wrap if persona_prompt absent).
if (configReviewers && configReviewers.length) {
  const reviewers = configReviewers.map((r, i) => ({
    reviewer_id: r.reviewer_id || ('R' + (i + 1)),
    domain: r.domain || 'general CS',
    persona_prompt: r.persona_prompt || buildPersona(r.domain || 'general CS', '(general reviewer; cover the full surface)'),
  }))
  log(`assign-reviewers: config-pinned ${reviewers.length} reviewers (no auto-assignment)`)
  return { reviewers, assignment_unverified: [], subfields: reviewers.map((r) => r.domain) }
}

const ASSIGN = {
  type: 'object', additionalProperties: false,
  properties: {
    reviewers: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { domain: { type: 'string' }, overlay: { type: 'string' } },
        required: ['domain', 'overlay'],
      },
    },
  },
  required: ['reviewers'],
}

function assignPrompt() {
  return [
    `You are the program chair assigning reviewers for ONE CS paper. Read it and name the ${N}`,
    'most relevant expert SUBFIELDS (by professional domain, e.g. "3D vision / neural rendering",',
    '"video object segmentation", "optimization theory", NOT a generic methodology axis). For',
    'EACH, write a short DOMAIN OVERLAY: 2-4 sentences of the failure modes and conventions a',
    'reviewer from that subfield is especially alert to in THIS paper. Pick subfields that',
    'cover the paper\'s actual contributions with minimal overlap.',
    `Venue style profile:\n${venueProfile}`,
    ISOLATION,
    '', 'THE MANUSCRIPT:', '"""', paper, '"""',
  ].join('\n')
}

const VER = {
  type: 'object', additionalProperties: false,
  properties: { on_topic: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['on_topic', 'reason'],
}
function verifyPrompt(domain) {
  return [
    'You independently sanity-check ONE reviewer assignment. Re-derive (in your head) the paper\'s',
    'real subfields, then judge: is the assigned domain clearly ON-TOPIC for this paper (a',
    'reviewer from it would be a good match)? Set on_topic=false only if it is plainly mismatched.',
    ISOLATION,
    '', `ASSIGNED DOMAIN: ${domain}`,
    '', 'THE MANUSCRIPT:', '"""', paper, '"""',
  ].join('\n')
}

const a = await agent(assignPrompt(), { label: 'assign', phase: 'Assign', schema: ASSIGN })
let proposed = (a && Array.isArray(a.reviewers)) ? a.reviewers.slice(0, N) : []
// pad to N with a generic slot if the agent under-produced
while (proposed.length < N) proposed.push({ domain: 'general CS (broad)', overlay: 'Cover the full review surface; no specialized lens.' })

const reviewers = proposed.map((p, i) => ({ reviewer_id: 'R' + (i + 1), domain: p.domain, persona_prompt: buildPersona(p.domain, p.overlay), _overlay: p.overlay }))

const assignment_unverified = []
if (verify) {
  const verdicts = await parallel(reviewers.map((r) => () =>
    agent(verifyPrompt(r.domain), { label: `verify:${r.reviewer_id}`, phase: 'Verify', schema: VER })
      .then((v) => ({ r, v }))))
  for (const { r, v } of verdicts) {
    if (!v || v.on_topic === false) {
      r.domain = 'general CS (gatekeeper)'
      r.persona_prompt = buildPersona(r.domain, '(assignment unverified; act as a general harsh gatekeeper covering the full review surface)')
      assignment_unverified.push(r.reviewer_id)
    }
  }
}
reviewers.forEach((r) => { delete r._overlay })

log(`assign-reviewers: ${reviewers.length} reviewers (${assignment_unverified.length} degraded to generic: ${assignment_unverified.join(',') || 'none'})`)
return { reviewers, assignment_unverified, subfields: reviewers.map((r) => r.domain) }
