// drafter.workflow.js -- v3 SENTENCE EXECUTION (review-engine-v3.md §43 roster).
// After a `valid-fixable` verdict, the author agent (a different hat from the
// defense) drafts the MINIMAL-edit fix that meets the judge's close_criterion while
// preserving the surrounding claim and NOT drifting a frozen spine anchor. The
// Workflow sandbox cannot write files, so the drafter only PROPOSES a patch
// {before, after}; the ORCHESTRATOR applies it (exact-string Edit), then runs the
// deterministic guards (compile-guard, anchor-diff -> meaning-audit) and either
// journals+closes it or rolls back+queues it (AUTO_MODE_DESIGN §5 bounded-aggressive).
//
// `before` MUST be an exact verbatim substring of the manuscript so the orchestrator
// can apply it as an exact-string Edit; keep it the SMALLEST span that needs to
// change. The minimal-edit / plain-CS-prose / LaTeX-safe / no-em-dash guards from
// references/writing-toolkit.md apply.
//
// args (JSON STRING -- parse defensively):
//   { venueProfile,
//     fixable:[ {charge_id, section, close_criterion, evidence_anchor} ],
//     units:[ {unit_id, section, text} ],
//     spine:[ {anchor_id, type, text} ] }
// Returns [ { charge_id, issue_id, before, after, rationale, touches_anchor, before_in_text, no_op } ].
// `before_in_text` is a deterministic check that `before` is actually present (the
// orchestrator re-checks too; a false here means re-draft).

export const meta = {
  name: 'drafter',
  description: 'drafter: for each valid-fixable charge, draft the minimal-edit patch meeting the close_criterion without drifting a spine anchor. Proposes {before,after}; the orchestrator applies + guards. paperjury review-engine v3.',
  phases: [{ title: 'Draft', detail: 'one author-agent per fixable charge proposes a minimal exact-string patch' }],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const fixable = A.fixable || []
const units = A.units || []
const spine = A.spine || []

const PATCH = {
  type: 'object', additionalProperties: false,
  properties: {
    before: { type: 'string' },
    after: { type: 'string' },
    rationale: { type: 'string' },
    touches_anchor: { type: 'boolean' },
  },
  required: ['before', 'after', 'rationale', 'touches_anchor'],
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const allText = norm(units.map((u) => u.text).join('\n'))
const spineNorms = spine.filter((s) => s.text).map((s) => norm(s.text))

function unitFor(c) {
  const a = norm(c.evidence_anchor)
  return units.find((u) => norm(u.text).includes(a))
    || units.find((u) => u.section === c.section || u.section_title === c.section || u.section_path === c.section)
    || units[0]
}

function draftPrompt(c) {
  const u = unitFor(c)
  return [
    'You are the AUTHOR drafting a MINIMAL edit to close one review charge. Make the',
    'SMALLEST change that satisfies the close_criterion AND preserves the surrounding',
    'claim\'s meaning. Output an exact-string patch:',
    '- `before`: copy VERBATIM the smallest contiguous span of the text below that you',
    '  are changing (it must appear exactly in the text).',
    '- `after`: that span rewritten. Plain CS prose, LaTeX-safe, NO em-dashes, no new',
    '  citations or numbers you cannot support, no revision notes in the text.',
    'If the only honest fix needs information not in the text (a new experiment, a',
    'number you do not have), do NOT fabricate: set before/after equal and explain in',
    'rationale that it needs the author (the orchestrator will queue it).',
    'Set touches_anchor=true if your `before` overlaps any FROZEN ANCHOR sentence',
    '(those must never be auto-edited).',
    '',
    `CHARGE [${c.section}]: close_criterion = ${c.close_criterion}`,
    `evidence_anchor: "${c.evidence_anchor}"`,
    '',
    'FROZEN ANCHORS (never edit these sentences):',
    spine.length ? spine.map((s) => `- [${s.anchor_id}] ${s.text}`).join('\n') : '(none)',
    '',
    `Venue style: ${A.venueProfile || '(default plain CS prose)'}`,
    '',
    `THE TEXT (unit ${u ? (u.section || u.section_title || u.section_path || '?') : '?'}):`,
    '"""', u ? u.text : '', '"""',
  ].join('\n')
}

const out = (await parallel(fixable.map((c) => () =>
  agent(draftPrompt(c), { label: `draft:${c.charge_id}`, phase: 'Draft', schema: PATCH })
    .then((p) => {
      if (!p) return null
      // deterministic guard: does `before` actually appear, and does it hit an anchor?
      // before_in_text uses norm() only as a TOLERANT presence check; `before` itself
      // stays VERBATIM (apply-patch.js does an exact-string match -- normalizing it
      // here would make it fail to match the real manuscript whitespace).
      const before_in_text = norm(p.before).length > 0 && allText.includes(norm(p.before))
      const hits_anchor_det = spineNorms.some((sn) => norm(p.before).includes(sn) || sn.includes(norm(p.before)))
      // issue_id mirrors charge_id so apply-patch.js (which journals issue_id) gets a
      // real id even on a direct pipe; the orchestrator still sets passage_id from the
      // ledger row when it constructs the apply-patch stdin.
      return { charge_id: c.charge_id, issue_id: c.charge_id, before: p.before, after: p.after, rationale: p.rationale,
        touches_anchor: p.touches_anchor || hits_anchor_det, before_in_text,
        no_op: norm(p.before) === norm(p.after) }
    })
))).filter(Boolean)

log(`drafter: ${out.length}/${fixable.length} patches; ${out.filter((p) => !p.before_in_text).length} with before-not-found, ${out.filter((p) => p.touches_anchor).length} touch an anchor, ${out.filter((p) => p.no_op).length} no-op (need human)`)

return out
