// coverage-auditor.workflow.js -- v3 anti-skim LAYER 2 (review-engine-v3.md §3.3).
// ONE auditor reads all N reviewers' per-section coverage reports + the whole paper and
// flags (reviewer_id, section) pairs that look SKIMMED: a section a reviewer marked
// skipped/light, OR a cross-reviewer disagreement (one calls a section thorough, another
// skipped) on a section that clearly carries reviewable content. It judges COVERAGE
// QUALITY only and files NO charges of its own. A flagged pair triggers an orchestrator
// cap-1 re-invoke of reading-check in `targets` mode (anti-skim L3).
//
// The orchestrator validates each returned flag against the real (reviewer_id, section)
// set and drops any that does not correspond to an actual coverage entry (never trust an
// agent to echo ids). Shardable by section if the paper is too large for one agent.
//
// args (JSON STRING -- parse defensively):
//   { paper, sections:[{section_path, section_title}],
//     reports:[ {reviewer_id, per_section_coverage:[{section,status,in_section_quote}]} ] }
// Returns { flags:[ {reviewer_id, section, reason} ] }.

export const meta = {
  name: 'coverage-auditor',
  description: 'v3 anti-skim L2: one auditor judges coverage QUALITY across all reviewers\' per-section coverage reports + the whole paper, flagging skimmed (reviewer,section) pairs incl. cross-reviewer disagreement. Files no charges. paperjury review-engine v3.',
  phases: [{ title: 'Coverage', detail: 'audit per-section coverage across reviewers; flag skims' }],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const paper = A.paper || ''
const sections = A.sections || []
const reports = A.reports || []
const ISOLATION = 'Work ONLY from the coverage reports and the manuscript quoted here. Do not read files or search the project.'

const FLAGS = {
  type: 'object', additionalProperties: false,
  properties: {
    flags: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { reviewer_id: { type: 'string' }, section: { type: 'string' }, reason: { type: 'string' } },
        required: ['reviewer_id', 'section', 'reason'],
      },
    },
  },
  required: ['flags'],
}

function coveragePrompt() {
  return [
    'You audit READING COVERAGE for a CS paper review. Below are the per-section coverage',
    'reports of several reviewers (each: section, status thorough|light|skipped, and a quote',
    'they say proves they read it) and the whole manuscript. Flag every (reviewer_id, section)',
    'where a reviewer likely SKIMMED a section that carries reviewable content:',
    '- status skipped or light on a substantive section (method/experiments/claims), OR',
    '- a cross-reviewer DISAGREEMENT (one thorough, another skipped/light) on such a section, OR',
    '- a quote that is too thin/generic to evidence a real read of that section.',
    'You judge COVERAGE QUALITY only. Do NOT file content charges. Do not flag a genuinely',
    'minor section (e.g. acknowledgements) just for being light.',
    ISOLATION,
    '',
    'SECTIONS:', sections.map((s) => `- ${s.section_path}${s.section_title ? ' (' + s.section_title + ')' : ''}`).join('\n') || '(none provided)',
    '',
    'COVERAGE REPORTS:', JSON.stringify(reports, null, 1),
    '',
    'THE MANUSCRIPT:', '"""', paper, '"""',
  ].join('\n')
}

let flags = []
if (reports.length) {
  const r = await agent(coveragePrompt(), { label: 'coverage-audit', phase: 'Coverage', schema: FLAGS })
  flags = (r && Array.isArray(r.flags)) ? r.flags : []
}

// validate each flag against the real (reviewer_id, section) coverage set
const realPairs = new Set()
const sectionByRid = new Map()
for (const rep of reports) {
  const set = new Set()
  for (const c of (rep.per_section_coverage || [])) { realPairs.add(rep.reviewer_id + '||' + c.section); set.add(c.section) }
  sectionByRid.set(rep.reviewer_id, set)
}
const norm = (s) => String(s || '').trim().toLowerCase()
function resolveSection(rid, sec) {
  if (realPairs.has(rid + '||' + sec)) return sec
  const set = sectionByRid.get(rid)
  if (!set) return null
  // tolerant match: the agent may paraphrase the section label
  for (const s of set) if (norm(s) === norm(sec) || norm(s).includes(norm(sec)) || norm(sec).includes(norm(s))) return s
  return null
}
const valid = []
for (const f of flags) {
  const sec = resolveSection(f.reviewer_id, f.section)
  if (sec) valid.push({ reviewer_id: f.reviewer_id, section: sec, reason: f.reason })
}

log(`coverage-auditor: ${flags.length} raw flags -> ${valid.length} valid (reviewer,section) skim flags`)
return { flags: valid }
