// review-panel.workflow.js  -- the fan-out engine for the paperjury skill.
//
// Under ultracode this runs the STRONG form: loop-until-dry panels with
// adversarial verification. With ultracode off, pass {maxRounds:1, verify:false}
// for the basic single-panel form.
//
// HOW TO RUN: the orchestrator (main session) invokes the Workflow tool with
// scriptPath = this file and `args` = the round inputs:
//
//   args = {
//     mode: "full" | "passage",
//     venueProfile: "<the venue style profile string from the resolved config>",
//     paperText: "<the FROZEN target unit, leakage-stripped, pasted inline>",
//     personas: [
//       { id: "R1", lensName: "Theory / Foundations",
//         personaPrompt: "<gatekeeper core + this lens, from reviewer-personas.md>",
//         agentType: "<optional: a project's named reviewer subagent; omit to use the default workflow agent>" },
//       { id: "R2", lensName: "Empirical / Benchmark", personaPrompt: "..." },
//       { id: "R3", lensName: "Applied / Systems",     personaPrompt: "..." }
//     ],
//     // ultracode knobs (defaults shown):
//     maxRounds: 4,        // hard cap on panel passes (backstop)
//     dryStop: 2,          // stop after this many consecutive passes that add no surviving issue
//     verify: true         // adversarial refutation of each new issue before it is kept
//   }
//
// Passing the frozen text INLINE in args is what enforces reviewer isolation:
// each reviewer agent sees only its persona + venue profile + text. It cannot see
// peers, the ledger, or prior rounds, because none of that is in its prompt.
//
// WHY loop-until-dry: one panel pass misses real issues (reviewers are
// stochastic). Re-running independent fresh panels and accumulating only the
// issues not already seen raises recall; K consecutive dry passes signal the tail
// is exhausted.
// WHY adversarial verify: a single reviewer can raise a plausible-but-wrong issue
// (misreading, something already handled in the text, out of scope for the venue).
// Perspective-diverse skeptics try to refute each candidate; an issue is kept
// unless a majority refute it (bias to keep, so real flaws are not lost; the human
// gate catches any residual noise).
//
// Returns { issues, refuted, dropped_no_criterion, rounds_run, per_round }.
// The orchestrator writes `issues` into the ledger as status `raised`, reports
// `refuted` and `dropped_no_criterion` for transparency, then stops for the
// author's per-issue direction (the human gate).

export const meta = {
  name: 'review-panel',
  description: 'Adversarial N-reviewer panel over one frozen paper unit, with loop-until-dry re-runs and perspective-diverse refutation of each issue. paperjury skill.',
  phases: [
    { title: 'Review', detail: 'N isolated reviewers per pass, each returns a schema-validated issue table' },
    { title: 'Merge', detail: 'dedupe within the pass and against everything seen so far' },
    { title: 'Verify', detail: 'perspective-diverse skeptics try to refute each new issue; keep survivors' },
  ],
}

// NOTE: this harness delivers the Workflow `args` global as a JSON STRING, not a
// parsed object (verified 2026-06-01). Parse defensively so the workflow works
// whether args arrives as a string or an already-parsed object. EVERY workflow in
// this skill must do this, or all args.* reads silently fall back to defaults.
const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const personas = A.personas || []
const maxRounds = A.maxRounds ?? 4
const dryStop = A.dryStop ?? 2
const doVerify = A.verify !== false

const ANGLES = [
  'misreading: the issue claims something is wrong or missing that is actually present or correct in the frozen text',
  'already-addressed: the concern is already handled elsewhere in the frozen text, so the issue does not stand',
  'scope-or-severity: the concern is real but out of scope for this venue, or its severity is materially overstated',
]

const ISSUE_TABLE = {
  type: 'object', additionalProperties: false,
  properties: {
    reviewer_id: { type: 'string' },
    pass1_fatal_flaws: { type: 'array', items: { type: 'string' } },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id_local: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          section: { type: 'string' },
          summary: { type: 'string' },
          close_criterion: { type: 'string' },
        },
        required: ['id_local', 'severity', 'section', 'summary', 'close_criterion'],
      },
    },
  },
  required: ['reviewer_id', 'pass1_fatal_flaws', 'issues'],
}

const ROUND_MERGE = {
  type: 'object', additionalProperties: false,
  properties: {
    new_issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          section: { type: 'string' },
          summary: { type: 'string' },
          close_criterion: { type: 'string' },
          raised_by: { type: 'array', items: { type: 'string' } },
        },
        required: ['severity', 'section', 'summary', 'close_criterion', 'raised_by'],
      },
    },
    dropped_no_criterion: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { summary: { type: 'string' }, reason: { type: 'string' } },
        required: ['summary', 'reason'],
      },
    },
  },
  required: ['new_issues', 'dropped_no_criterion'],
}

const VERIFY = {
  type: 'object', additionalProperties: false,
  properties: {
    refuted: { type: 'boolean' },
    angle: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'angle', 'reason'],
}

function reviewerPrompt(p) {
  return [
    p.personaPrompt,
    '',
    `Your lens: ${p.lensName}. Cover the full review surface; the lens is a tendency, not a fence.`,
    `Venue style profile:\n${A.venueProfile}`,
    `Review mode: ${A.mode}.`,
    '',
    'Produce, in order: (1) a Pass-1 fatal-flaw diagnostic list, (2) a Pass-2 forensic',
    'interrogation per flaw (where exactly, why, what evidence settles it, fatal vs',
    'fixable). Then return the structured issue table. Every issue MUST carry a',
    'concrete close_criterion (one sentence describing what an edit must satisfy);',
    'issues without one will be dropped. Anchor each issue to a precise section /',
    'equation / table / figure / paragraph. Do not be agreeable; do not invent',
    'problems to look thorough; name real flaws exactly.',
    '',
    'THE FROZEN PAPER UNIT (all you may judge; you cannot see other reviewers, the',
    'ledger, or prior passes):',
    '"""',
    A.paperText,
    '"""',
  ].join('\n')
}

function mergePrompt(reviews, seen) {
  return [
    'You are the orchestrator merging one pass of an adversarial review panel.',
    'Input: each reviewer\'s issue table (JSON below), plus a SEEN list of issue',
    'summaries already captured in earlier passes.',
    '',
    'Rules:',
    '- Dedupe within this pass: issues raised by >=2 reviewers collapse into ONE row',
    '  whose raised_by lists every source reviewer. Same issue only when the section',
    '  anchor matches AND the summaries/criteria genuinely overlap; when unsure keep',
    '  them separate.',
    '- Exclude anything already in SEEN (judge by meaning, not string match). Only',
    '  return issues that are genuinely NEW this pass.',
    '- Drop any issue missing a usable close_criterion into dropped_no_criterion.',
    '- Do NOT invent issues; only merge what reviewers raised. No global IDs (assigned later).',
    '',
    'SEEN (already captured, do not re-report):',
    JSON.stringify(seen, null, 2),
    '',
    'Reviewer issue tables this pass:',
    JSON.stringify(reviews, null, 2),
  ].join('\n')
}

function verifyPrompt(issue, angle) {
  return [
    'You are an ADVERSARIAL verifier. Try to REFUTE the issue below, judged ONLY',
    `from this angle: ${angle}.`,
    '',
    'Set refuted=true ONLY if, from this angle, the issue does not hold (give the',
    'reason grounded in the frozen text). Otherwise refuted=false. Be skeptical but',
    'fair: do not refute a genuine flaw just to look decisive, and do not rubber-stamp.',
    '',
    'ISSUE:',
    `  severity: ${issue.severity}`,
    `  section: ${issue.section}`,
    `  summary: ${issue.summary}`,
    `  close_criterion: ${issue.close_criterion}`,
    '',
    'THE FROZEN PAPER UNIT:',
    '"""',
    A.paperText,
    '"""',
  ].join('\n')
}

const confirmed = []
const seen = []
const refutedLog = []
const droppedNoCriterion = []
const perRound = []
let dry = 0
let round = 0

while (dry < dryStop && round < maxRounds) {
  round++
  if (budget.total && budget.remaining() < 40000) {
    log(`budget low (${Math.round(budget.remaining() / 1000)}k left); stopping the loop early`)
    break
  }

  const reviews = (await parallel(
    personas.map((p) => () =>
      agent(reviewerPrompt(p), {
        label: `r${round}:review:${p.id}`,
        phase: 'Review',
        schema: ISSUE_TABLE,
        ...(p.agentType ? { agentType: p.agentType } : {}),
      })
    )
  )).filter(Boolean)

  const merge = await agent(mergePrompt(reviews, seen), { label: `r${round}:merge`, phase: 'Merge', schema: ROUND_MERGE })
  droppedNoCriterion.push(...(merge.dropped_no_criterion || []))
  const candidates = merge.new_issues || []

  if (candidates.length === 0) {
    dry++
    perRound.push({ round, candidates: 0, survived: 0, dry })
    log(`pass ${round}: no new issues (dry ${dry}/${dryStop})`)
    continue
  }
  candidates.forEach((c) => seen.push(c.summary))

  let survivors = candidates
  if (doVerify) {
    const judged = await parallel(
      candidates.map((c) => () =>
        parallel(
          ANGLES.map((a) => () => agent(verifyPrompt(c, a), { label: `r${round}:verify:${(c.section || '').slice(0, 20)}`, phase: 'Verify', schema: VERIFY }))
        ).then((vs) => {
          const v = vs.filter(Boolean)
          const refuted = v.filter((x) => x.refuted).length
          return { issue: c, survived: refuted < Math.ceil(ANGLES.length / 2), verdicts: v, refutedCount: refuted }
        })
      )
    )
    survivors = judged.filter((j) => j && j.survived).map((j) => j.issue)
    judged.filter((j) => j && !j.survived).forEach((j) => refutedLog.push({ issue: j.issue, refutedCount: j.refutedCount, verdicts: j.verdicts }))
  }

  if (survivors.length === 0) {
    dry++
  } else {
    dry = 0
    confirmed.push(...survivors)
  }
  perRound.push({ round, candidates: candidates.length, survived: survivors.length, dry })
  log(`pass ${round}: ${candidates.length} new, ${survivors.length} survived verify, total ${confirmed.length} (dry ${dry}/${dryStop})`)
}

const rank = { blocker: 0, major: 1, minor: 2, nit: 3 }
const issues = confirmed
  .slice()
  .sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
  .map((iss, i) => ({ ...iss, id: 'I-' + String(i + 1).padStart(2, '0'), status: 'raised' }))

return { issues, refuted: refutedLog, dropped_no_criterion: droppedNoCriterion, rounds_run: round, per_round: perRound }

// NOTE: this single-pass panel is the QUICK-CHECK path. The courtroom engine
// (per-issue charge -> screen -> trial -> three-way routing -> recall) is now BUILT
// and is the default for review mode: see references/review-engine-v3.md and the
// workflows/{reading-check,coverage-auditor,trial,polish,recall-audit,drafter}.workflow.js.
// DISCUSSION-PHASE VARIANT (separate run, after the author gives direction):
// pass args = { contested: [ { persona, ownReport, authorResponseSlice, issueIds } ] }
// and run parallel() over `contested`, each agent in discussion mode returning
// per-issue { issueId, verdict: concede|refine|maintain, rationale, refined_criterion? }.
// Give each ONLY its own report + the author-response slice for its issues. The
// orchestrator then updates the ledger and runs the author tiebreak on maintains.
