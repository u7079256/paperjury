// reading-check.workflow.js -- v3 GENERATION (review-engine-v3.md §3.2-3.3).
// N domain-expert HOLISTIC reviewers each read the WHOLE paper ONCE and file
// weaknesses, NOT a per-(unit x lens) fan-out and NOT loop-until-dry (v2's flood at
// full-paper scale). Each reviewer is a project-provided persona (gatekeeper core +
// a generated domain overlay + venue profile), instantiated by assign-reviewers and
// passed in here as `persona_prompt`. The cross-section mandate is baked into the
// persona, so holistic readers catch abstract-vs-results / notation-clash natively
// (no separate cross-unit agent).
//
// ANTI-SKIM lives here as: (a) each reviewer must account for EVERY section with a
// per_section_coverage entry carrying an in-section verbatim quote, and (b) a
// deterministic quote-verify tags any weakness/coverage quote not actually present
// (cannot quote = did not read). The orchestrator runs L1 (quote-verify) + an L2
// coverage-auditor and, on a skim flag, re-invokes THIS workflow in `targets` mode
// (cap-1, one reviewer x one section) -- merge happens AFTER anti-skim in merge.WF.
//
// NO close_criterion here (v3): the reviewer files the weakness; the judge sets the
// close_criterion on a valid-fixable verdict. NO adversarial verify here (the trial
// does that). The reviewer only reports.
//
// args (JSON STRING -- parse defensively):
//   { paper:    "the WHOLE manuscript body (flattened) as one string",
//     reviewers:[ { reviewer_id, domain, persona_prompt } ],   // from assign-reviewers
//     sections: [ { section_path, section_title } ],           // from decompose units (coverage list)
//     venueProfile, mode,
//     targets:  [ { reviewer_id, section } ] | null }          // set => L3 re-invoke ONLY these
// Returns [ { reviewer_id, overall_confidence, weaknesses:[...], per_section_coverage:[...] } ].

export const meta = {
  name: 'reading-check',
  description: 'v3 generation: N domain holistic reviewers each read the whole paper once and file weaknesses (significance+kind+verbatim quote) + one overall_confidence + a per-section coverage report. Targeted re-invoke mode backs the anti-skim L3. No merge, no verify (those are separate steps). paperjury review-engine v3.',
  phases: [
    { title: 'Read', detail: 'one holistic reviewer per persona reads the whole paper and files weaknesses + coverage' },
  ],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const paper = A.paper || ''
const reviewers = A.reviewers || []
const sections = A.sections || []
const venueProfile = A.venueProfile || '(unspecified venue)'
const mode = A.mode || 'full'
const targets = Array.isArray(A.targets) ? A.targets : null

const ISOLATION = 'Judge ONLY the manuscript quoted in this prompt. Do not read files, search the project, or use any tool to find other context (the ledger, prior rounds, other reviewers, or any real manuscript on disk); base your review solely on the text quoted here.'

const WEAKNESS = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    evidence_anchor: { type: 'string' },
    section: { type: 'string' },
    significance: { type: 'string', enum: ['major', 'minor'] },
    kind: { type: 'string', enum: ['mechanical', 'substantive'] },
    references: { type: ['string', 'null'] },
  },
  required: ['summary', 'evidence_anchor', 'section', 'significance', 'kind'],
}
const COVERAGE = {
  type: 'object', additionalProperties: false,
  properties: {
    section: { type: 'string' },
    status: { type: 'string', enum: ['thorough', 'light', 'skipped'] },
    in_section_quote: { type: 'string' },
  },
  required: ['section', 'status', 'in_section_quote'],
}
const REPORT = {
  type: 'object', additionalProperties: false,
  properties: {
    overall_confidence: { type: 'integer', minimum: 1, maximum: 5 },
    weaknesses: { type: 'array', items: WEAKNESS },
    per_section_coverage: { type: 'array', items: COVERAGE },
  },
  required: ['overall_confidence', 'weaknesses', 'per_section_coverage'],
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
const paperNorm = norm(paper)
function quoteVerified(q) { const nq = norm(q); return nq.length > 0 && paperNorm.includes(nq) }

const sectionList = sections.length
  ? sections.map((s) => `- ${s.section_path}${s.section_title ? ' (' + s.section_title + ')' : ''}`).join('\n')
  : '(no section list provided; account for every section you find in the text)'

function reviewPrompt(rev, focusSection) {
  return [
    rev.persona_prompt,
    '',
    `Your expert domain: ${rev.domain || '(general CS reviewer)'}. You cover the full review`,
    'surface (originality, soundness, significance, clarity, impact); your domain is a',
    'sensitivity, not a fence. You MUST reason across sections (abstract vs results,',
    'notation reused across sections, a contribution the experiments do not validate).',
    `Venue style profile:\n${venueProfile}`,
    `Review mode: ${mode}.`,
    '',
    'You are a HOLISTIC reviewer. Read the WHOLE manuscript below and file WEAKNESSES.',
    'For EACH weakness give:',
    '- summary: one line, what is wrong.',
    '- evidence_anchor: an EXACT VERBATIM quote from the manuscript the weakness rests',
    '  on (copy it character-for-character; do not paraphrase). Cannot quote = do not file.',
    '- section: a precise anchor (section + eq/table/figure/paragraph).',
    '- significance: major (a flaw that affects the paper\'s claims/soundness/contribution)',
    '  or minor (a local problem that does not threaten the central claims).',
    '- kind: substantive (a claim/method/evidence/clarity problem that needs judgment) or',
    '  mechanical (a copy-edit class issue: typo, formatting, a notation slip, a phrasing nit).',
    '  When unsure between the two, choose substantive (it will get a proper hearing).',
    '- references: optional, what would settle it or which other section it implicates (may be "").',
    'Do NOT propose the fix or a close_criterion (that is decided later). Do NOT invent',
    'flaws to look thorough and do NOT soften a real one.',
    '',
    'ANTI-SKIM: you MUST also return per_section_coverage with ONE entry for EVERY section',
    'listed below: {section, status (thorough|light|skipped), in_section_quote = an exact',
    'verbatim quote FROM THAT SECTION proving you read it}. A section you genuinely cannot',
    'quote is `skipped`.',
    'Finally give ONE overall_confidence (1-5) for this review as a whole.',
    ISOLATION,
    focusSection
      ? `\nRE-READ FOCUS: a coverage check flagged that you under-read section "${focusSection}". Read it carefully now; file any weaknesses there and return an accurate coverage entry for it (you may return only that section\'s coverage + its weaknesses).`
      : '',
    '',
    'SECTIONS TO ACCOUNT FOR:',
    sectionList,
    '',
    'THE MANUSCRIPT (all you may judge):',
    '"""', paper, '"""',
  ].filter(Boolean).join('\n')
}

// Tag every quote with the deterministic quote-verify (cheap string match on the
// inline paper; the orchestrator re-checks for the re-invoke decision).
function tag(report) {
  for (const w of (report.weaknesses || [])) w.quote_verified = quoteVerified(w.evidence_anchor)
  for (const c of (report.per_section_coverage || [])) c.quote_verified = quoteVerified(c.in_section_quote)
  return report
}

// L3 targeted re-invoke: run only the flagged (reviewer, section) pairs.
const jobs = targets
  ? targets.map((t) => {
      const rev = reviewers.find((r) => r.reviewer_id === t.reviewer_id) || reviewers[0]
      return () => agent(reviewPrompt(rev, t.section), { label: `reread:${t.reviewer_id}:${t.section}`, phase: 'Read', schema: REPORT })
        .then((r) => (r ? { reviewer_id: t.reviewer_id, reread_section: t.section, ...tag(r) } : null))
    })
  : reviewers.map((rev) =>
      () => agent(reviewPrompt(rev, null), { label: `read:${rev.reviewer_id}`, phase: 'Read', schema: REPORT })
        .then((r) => (r ? { reviewer_id: rev.reviewer_id, ...tag(r) } : null)))

const reports = (await parallel(jobs)).filter(Boolean)

const totalW = reports.reduce((n, r) => n + (r.weaknesses || []).length, 0)
const unq = reports.reduce((n, r) => n + (r.weaknesses || []).filter((w) => !w.quote_verified).length, 0)
log(`reading-check: ${reports.length} ${targets ? 're-read reports' : 'reviewers'}, ${totalW} weaknesses (${unq} with unverified quotes)`)

return reports
