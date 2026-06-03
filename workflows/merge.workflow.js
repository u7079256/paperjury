// merge.workflow.js -- v3 MERGE (review-engine-v3.md §3.4). Runs AFTER the anti-skim
// loop (reading-check + coverage-auditor + L3 re-invokes), over the FINAL weakness
// set from all N reviewers. Semantic dedup across reviewers; the merge agent does
// ONLY the grouping it is uniquely able to do (which weaknesses are the same issue,
// and the clearest framing); every DERIVED field is computed deterministically in
// this workflow from the cluster's members, never trusted to the agent:
//   significance = MAX (major dominates),  kind = substantive if ANY member substantive,
//   raised_by    = unique reviewer_ids,    raised_by_count = |raised_by|,
//   reviewer_confidence = MAX over members, evidence_anchor/section = the representative.
// close_criterion stays null here (the judge sets it on a valid-fixable verdict, §2.3).
// Safety: any input weakness the agent leaves unclustered becomes its OWN singleton
// issue, so merge can never silently drop a weakness.
//
// args (JSON STRING -- parse defensively):
//   { weaknesses: [ { reviewer_id, summary, evidence_anchor, section, significance,
//                     kind, references, reviewer_confidence } ] }   // orchestrator-flattened
// Returns { issues: [ { summary, evidence_anchor, section, significance, kind, references,
//                       raised_by:[id], raised_by_count, reviewer_confidence } ],
//           clustered, singletons }.

export const meta = {
  name: 'merge',
  description: 'v3 merge: one agent semantically clusters the N reviewers\' weaknesses (and writes the wiser framing); the workflow then derives significance(MAX)/kind(substantive-dominates)/raised_by/corroboration/confidence deterministically per cluster, with a singleton fallback so nothing is dropped. paperjury review-engine v3.',
  phases: [{ title: 'Merge', detail: 'cluster duplicate weaknesses across reviewers by index + pick the clearest framing' }],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const weaknesses = (A.weaknesses || []).map((w, i) => ({ idx: i, ...w }))
const ISOLATION = 'Work ONLY from the weakness list quoted here. Do not read files or search the project.'

const CLUSTERS = {
  type: 'object', additionalProperties: false,
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          member_indices: { type: 'array', items: { type: 'integer' } },
          representative_index: { type: 'integer' },
          summary: { type: 'string' },
          references: { type: 'string' },
        },
        required: ['member_indices', 'representative_index', 'summary', 'references'],
      },
    },
  },
  required: ['clusters'],
}

function mergePrompt() {
  return [
    'You merge the weaknesses filed by several independent reviewers of ONE paper into a',
    'deduplicated issue list. Each weakness has an `idx`. Your ONLY jobs:',
    '1. GROUP weaknesses that are THE SAME underlying issue into one cluster (list their',
    '   member_indices). Two weaknesses are the same only when the section anchor AND the',
    '   substance genuinely match; when unsure, keep them SEPARATE (a missed merge is',
    '   recoverable; a wrong merge hides a distinct issue).',
    '2. Pick representative_index = the member whose evidence_anchor + section are the most',
    '   precise (its quote/section will be used verbatim).',
    '3. Write `summary` = the clearest one-line framing of the cluster, and `references` =',
    '   the most useful pointer (may be "").',
    'Do NOT decide significance, kind, or who raised it; those are computed for you. Cover',
    'EVERY idx in exactly one cluster (a unique weakness is a one-member cluster).',
    ISOLATION,
    '',
    'WEAKNESSES:',
    JSON.stringify(weaknesses.map((w) => ({ idx: w.idx, reviewer_id: w.reviewer_id, section: w.section, significance: w.significance, kind: w.kind, summary: w.summary, evidence_anchor: w.evidence_anchor })), null, 1),
  ].join('\n')
}

function buildIssue(members, repIdx, agentSummary, agentRefs) {
  const rep = weaknesses[repIdx] || members[0]
  const significance = members.some((m) => m.significance === 'major') ? 'major' : 'minor'
  const kind = members.some((m) => m.kind === 'substantive') ? 'substantive' : 'mechanical'
  const raised_by = [...new Set(members.map((m) => m.reviewer_id).filter(Boolean))]
  const confs = members.map((m) => m.reviewer_confidence).filter((x) => typeof x === 'number')
  return {
    summary: agentSummary || rep.summary,
    evidence_anchor: rep.evidence_anchor,
    section: rep.section,
    significance, kind,
    references: agentRefs || rep.references || '',
    raised_by,
    raised_by_count: raised_by.length,
    reviewer_confidence: confs.length ? Math.max(...confs) : null,
    close_criterion: null,
  }
}

let clusters = []
if (weaknesses.length) {
  const r = await agent(mergePrompt(), { label: 'merge', phase: 'Merge', schema: CLUSTERS })
  clusters = (r && Array.isArray(r.clusters)) ? r.clusters : []
}

// Deterministically realize clusters; back-fill any idx the agent dropped as a singleton.
const seen = new Set()
const issues = []
for (const c of clusters) {
  const idxs = [...new Set((c.member_indices || []).filter((i) => Number.isInteger(i) && i >= 0 && i < weaknesses.length && !seen.has(i)))]
  if (!idxs.length) continue
  idxs.forEach((i) => seen.add(i))
  const repIdx = idxs.includes(c.representative_index) ? c.representative_index : idxs[0]
  issues.push(buildIssue(idxs.map((i) => weaknesses[i]), repIdx, c.summary, c.references))
}
let singletons = 0
for (let i = 0; i < weaknesses.length; i++) {
  if (seen.has(i)) continue
  singletons++
  issues.push(buildIssue([weaknesses[i]], i, null, null))
}

log(`merge: ${weaknesses.length} weaknesses -> ${issues.length} issues (${issues.length - singletons} clustered groups + ${singletons} singletons recovered)`)

return { issues, clustered: issues.length - singletons, singletons }
