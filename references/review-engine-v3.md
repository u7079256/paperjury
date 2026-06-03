# Review engine v3 -- the orchestration protocol (BUILT)

The courtroom per-issue adjudication engine, v3 (design rationale:
`docs/REVIEW_ENGINE_V3_DESIGN.md`). This is the OPERATIONAL protocol: how the
ORCHESTRATOR (the main session, driven across turns by `/goal` in auto) sequences
deterministic scripts and semantic workflows into a round, and the exact CONTRACTS at
each seam. It supersedes `review-engine-v2.md` (v2 prosecution = per-unit-x-lens flood;
v3 = N holistic reviewers + contestability routing + a polish track + a clerk-converged
outer loop). The engine is shared by review v3 and auto.

The Workflow sandbox has no filesystem or subprocess: every deterministic guard runs
ORCHESTRATOR-side (Node, via Bash, using each script's module API or CLI), BETWEEN
workflow calls. Workflows do semantic fan-out only and receive their inputs INLINE in
`args` (a JSON string; every workflow parses it defensively). Reviewer/juror/judge
prompts carry an ISOLATION line. All engine agents run on Opus 4.8 (no Haiku); effort
is session-level (max where available, else xhigh).

## Inventory (what runs)

Deterministic, orchestrator-side (Node):
| script | role |
|---|---|
| `scripts/decompose.js` | split the manuscript into reading units + paragraph passages with stable `passage_id`s (anti-drift substrate + the canonical section list + juror/local-context source) |
| `scripts/ledger.js` | JSON ledger + MD view; `gate` = the /goal completion fact; `docket`/`unadjudicated` queries |
| `scripts/journal.js` | append-only per-edit revert log |
| `scripts/apply-patch.js` | atomic apply + journal of a drafted patch, and revert (exact-once guard) |
| `scripts/anchor-diff.js` | locate frozen anchors, flag which need a meaning audit (edit-safety, anchors) |
| `scripts/cross-ref.js` | edit-safety risk pre-filter: does a CHANGED salient token in a patch appear in OTHER passages? |
| `scripts/spine.js` | freeze the extracted anchors into spine.json |
| `scripts/compile-guard.js` | real LaTeX compile (or degrade lint); rollback signal |
| `scripts/compliance-check.js` | submission-readiness deterministic checks |

Semantic, workflow fan-out (`workflows/*.workflow.js`):
| workflow | role |
|---|---|
| `assign-reviewers` | name N subfields, instantiate N domain reviewers from the project gatekeeper core; config-pin / verifier / per-slot degrade |
| `reading-check` | N holistic reviewers read the whole paper -> weaknesses + one overall_confidence + per-section coverage; targeted re-invoke mode |
| `coverage-auditor` | anti-skim L2: flag skimmed (reviewer, section) pairs across the coverage reports |
| `merge` | semantic dedup across reviewers (clusters); the workflow derives significance/kind/corroboration deterministically |
| `trial` | the 5-tier: whole-paper defense -> local-context jury (+ on-demand expansion) -> deterministic quorum/majority + judge routing; escalate to 12 |
| `polish` | the off-gate track: batch copy-edit (mechanical) + batch light-check (minor-substantive); can escalate to trial |
| `recall-audit` | Mode A revive wrong drops + Mode B spot-check strong-consensus majors before the edit |
| `drafter` | per valid-fixable charge, the minimal-edit patch |
| `edit-audit` | edit-safety semantic half for RISKY non-anchor edits (make-sense + cross-section alignment) |
| `meaning-audit` | edit-safety for FROZEN anchors: four-state audit + arc check (unchanged from v2) |

DELETED vs v2: `grand-jury.workflow.js` (its "addressed elsewhere" catch moved into the
trial's whole-paper DEFENSE).

## The data-contract pipe (canonical I/O + the orchestrator enrichment seams)

Workflows are independent invocations; they do NOT import each other. The orchestrator
passes each workflow's output (after a deterministic ENRICHMENT step) as the next one's
input. The enrichment seams below are load-bearing: a workflow emits only what it can
know; the orchestrator supplies the rest from the ledger / decompose / loop context.

```
assign-reviewers -> { reviewers:[{reviewer_id, domain, persona_prompt}], assignment_unverified:[id] }
   [ledger.meta.assignment_unverified = that array]

reading-check(paper, reviewers, sections=decompose sections, venueProfile)
   -> [ per reviewer: {reviewer_id, overall_confidence, weaknesses:[{summary, evidence_anchor,
        section, significance, kind, references?}], per_section_coverage:[{section, status,
        in_section_quote}]} ]
   [SEAM 5] sections MUST come from `decompose.js` (the canonical section list for coverage + L1 quote-verify).

coverage-auditor(paper, sections, reports) -> { flags:[{reviewer_id, section, reason}] }
   [orchestrator: each flag -> reading-check targets:[{reviewer_id, section}] re-invoke, cap-1]

[SEAM 2] orchestrator FLATTEN: for every weakness across all (post-anti-skim) reports, attach
   reviewer_id and reviewer_confidence (= that reviewer's overall_confidence) ->
   weaknesses:[{reviewer_id, summary, evidence_anchor, section, significance, kind, references, reviewer_confidence}]

merge(weaknesses) -> { issues:[{summary, evidence_anchor, section, significance, kind, references,
        raised_by:[id], raised_by_count, reviewer_confidence}] }   (close_criterion = null)
   [ledger.js add] each issue -> a row status `raised`, global id I-xx. passage_id set by the
   orchestrator from decompose (the row's section/anchor -> the containing passage's passage_id).

ROUTING (deterministic, on the ledger rows):
   kind=mechanical            -> polish
   substantive & minor        -> polish
   substantive & major        -> trial

[SEAM 1] orchestrator: trial charges = ledger rows with charge_id = row.id, carrying
   {charge_id, section, summary, evidence_anchor, significance, kind, references}.

trial(charges, paper, units=decompose units, claim_spine=abstract+intro, spine, jurySize=5)
   -> [ {charge_id, verdict in {invalid-drop, valid-fixable, author-required, escalate},
        close_criterion|null, rationale, tally:{valid,invalid,context_limited}, jury_size,
        escalated, defense, votes} ]
   [orchestrator] verdict=escalate -> collect, re-invoke trial(thoseCharges, jurySize=12, escalated:true).
   [ledger.js set] valid-fixable (+ close_criterion), author-required, invalid-drop (-> DROPS pool).
                   store `tally` and `escalated` on the row.

polish(items=polish-routed rows, paper, venueProfile)
   -> { patches:[{issue_id, kind, before, after, before_in_text, no_op}],
        dropped:[{issue_id, reason}], escalate_to_trial:[{issue_id, reason}],
        flagged:[{issue_id, reason}] }
   [SEAM 6] flagged -> ledger.js set status `queued`, reason_code `polish-review` (NEVER dropped).
   [orchestrator] escalate_to_trial -> ledger status `re-trial` -> ONE bounded in-round re-trial pass
        (trial @ jurySize 5). dropped -> the DROPS pool (source 'polish').

[SEAM 3] orchestrator CONSENSUS FILTER for recall Mode B: from the valid-fixable MAJORS, select
   those with tally.valid >= 0.8*jury_size AND escalated==false; enrich each with
   reviewer_confidence + raised_by_count from its ledger row.

recall-audit(drops=[{charge_id, significance, section, summary, close_criterion, evidence_anchor,
        drop_reason, source:'trial'|'polish'}], consensus_majors=[...enriched], paper, skeptics)
   -> { confirmed_drops:[charge_id], revived:[{charge_id, reason, recommend:'re-trial'|'escalate'}],
        spotcheck:[{charge_id, action:'hold'|'to-author-required', reason}] }
   [SEAM 7/8 ledger] confirmed_drops -> `dropped` (reason in notes). revived recommend 're-trial'
        -> status `re-trial` (re-run @5); recommend 'escalate' -> status `in-trial`, re-run @12
        (escalated:true). spotcheck 'to-author-required' -> setStatus(author-required,
        reason_code 'claim-meaning-change') AND remove from the drafter `fixable` input.

drafter(fixable = surviving valid-fixable rows {charge_id, section, close_criterion, evidence_anchor},
        units, spine, venueProfile)
   -> [ {charge_id, issue_id, before, after, rationale, touches_anchor, before_in_text, no_op} ]
   [SEAM 4] orchestrator builds the apply-patch stdin = {issue_id, passage_id (from the ledger row),
        before, after, close_criterion (from the ledger row), round (loop)} -- drafter emits none of
        those three; the LEDGER ROW is the single source.

EDIT-SAFETY (per patch, BEFORE apply):
   [det] anchor-diff(spine, current, baseline) -> need_audit anchors.
   [det] cross-ref(patch) on current -> {risky, hits:[{token, passage_id}]}.
   LOW (no anchor flagged, not risky, compiles) -> apply-patch.js apply -> compile-guard -> close.
   RISKY anchor   -> meaning-audit(anchors=need_audit, spine) -> {anchor_verdicts, arc};
                     any verdict != holds (auto) -> revert + queue (claim-meaning-change).
   RISKY non-anchor -> [SEAM 9] edit-audit(edits=[{issue_id, before, after,
                     cross_ref_hits = cross-ref hits}], passages = decompose(current))
                     -> {edit_verdicts:[{issue_id, verdict:'holds'|'drift', reason, offending_text}]};
                     drift -> revert + queue.
   [SEAM 10] edit-audit and meaning-audit are SEPARATE workflows with distinct outputs; never conflate.

[round end] clerk:
   [SEAM 11] thisRound = ledger rows with round_raised == current_round (post-inner-loop, with
        passage_id + status). carried = ledger.js docket(current_round). appliedEdits = this round's
        journal entries. [SEAM 14] every row (carried + this-round) must carry a passage_id (the
        clerk merge key is passage_id AND similarity).
clerk(carried, thisRound, appliedEdits, paper, simThreshold=0.8)
   -> { reconciled:[{ledger_id, outcome:'closed'|'invalidated'|'still-open', reason}],
        merges:[{this_round_id, into}], genuinely_new:[ledger_id...],
        genuinely_new_count, new_closures_count, new_author_required_count, converged }
   [SEAM 12] for each merge {this_round_id, into}: ledger -> target row raised_by union +
        raised_by_count++ (corroboration), keep the wiser framing; the this_round_id row is folded
        (status `withdrawn`, note "merged into <into>"), never silently dropped.
   genuinely_new is a list of IDs (the rows are already in the cumulative ledger; the orchestrator
        resolves content from there -- single source of truth).
```

## One round (orchestrator sequence)

`[det]` Node script; `[WF]` workflow; `[ledger]`/`[journal]` state write; `[human]` a
pre-loop gate (review) or a queue entry (auto). The PHASE DAG is sequential by data
dependency; never splice a phase-N tail with a phase-(N+1) head when batching.

1. `[det]` **decompose**: `node decompose.js units|passages <tex>` -> units (juror/drafter
   context + the canonical section list) + passages (passage_ids).
2. `[det]` (once) **spine**: extract anchors (agent) -> author confirm `[human pre-flight]` ->
   `node spine.js freeze`. Keep the round-0 frozen text as the cumulative baseline.
3. `[WF][human pre-flight]` **assign-reviewers** -> reviewers + assignment_unverified.
   `[ledger.meta]` record assignment_unverified. Review: surface the assignment (and any
   degrade) to the author before the loop. Auto: config-pin or the verifier degrade; never block.
4. `[WF]` **reading-check**(paper, reviewers, sections, venueProfile) -> per-reviewer reports.
5. `[det]` **anti-skim L1**: quote-verify each `in_section_quote` against the section text;
   a `skipped`/failed section -> a cap-1 `reading-check` re-invoke in `targets` mode.
6. `[WF]` **coverage-auditor**(paper, sections, reports) -> flags. `[det/WF]` **L3**: each flag
   -> a cap-1 `reading-check` `targets` re-invoke. Merge the re-invoke weaknesses into the set.
7. `[det]` **flatten** (SEAM 2) -> weaknesses with reviewer_id + reviewer_confidence.
8. `[WF]` **merge**(weaknesses) -> issues. `[ledger]` intake as `raised`; set passage_id per row.
9. `[det]` **route** (SEAM, deterministic): mechanical / minor-substantive -> polish set;
   substantive-major -> trial set.
10. `[WF]` **trial**(trial charges, paper, units, claim_spine, spine, jurySize=5). BATCH under
    `MAX_AGENTS_PER_WF` (~600; per charge ~= jury_size + defense + judge). `[ledger]` per verdict;
    store tally + escalated. Collect `escalate` -> `[WF]` re-invoke trial(jurySize=12, escalated:true);
    deadlock @12 -> author-required.
11. `[WF]` **polish**(polish set, paper, venueProfile). `[ledger]` flagged -> queued(polish-review);
    escalate_to_trial -> re-trial; dropped -> DROPS(source polish). `[WF]` (if any re-trial) the
    bounded re-trial pass.
12. `[det]` **consensus filter** (SEAM 3) -> consensus_majors. `[WF]` **recall-audit**(drops,
    consensus_majors, paper, skeptics). `[ledger]` apply revived / confirmed_drops / spotcheck
    transitions (SEAM 7/8); drop the spotcheck->author-required rows from the fixable set.
13. `[WF]` **drafter**(surviving valid-fixables, units, spine, venueProfile). Per patch, the
    EDIT-SAFETY chain (SEAM 4 + 9 + 10): build apply-patch stdin from the ledger row; anchor-diff +
    cross-ref classify; LOW -> apply-patch + compile-guard; RISKY -> meaning-audit (anchor) /
    edit-audit (non-anchor); holds -> `[ledger]` closed; else revert + queue.
14. `[det]` **report**: `node ledger.js render` + `count`. Review: stop, do not auto-advance.
    Auto: proceed to the clerk + the outer loop.
15. `[WF]` **clerk** (round boundary; SEAM 11/12/14) -> reconciliation + convergence counts.
    `[ledger]` apply reconciled outcomes + merges. `[det]` compute the convergence + termination.

## Ledger / journal wiring (v3 status transitions)
```
merge intake             -> raised (significance/kind set; close_criterion null; passage_id set)
route substantive-major  -> (trial) in-trial
trial valid-fixable      -> valid-fixable (+ judge close_criterion) --recall ModeB-hold--> drafter --guards--> closed | queued
trial author-required    -> author-required (gate-ok; accumulates to 终审)
trial invalid-drop       -> DROPS pool --recall ModeA--> dropped | revived
trial escalate           -> stays in-trial; orchestrator re-runs @12 (escalated:true)
polish mechanical/minor  -> patch --edit-safety--> closed | queued ; flagged -> queued(polish-review) ; dropped -> DROPS
recall revived           -> re-trial (re-run @5) | in-trial (escalate, re-run @12)
recall spotcheck unsound -> author-required (claim-meaning-change), removed from fixable
clerk merge              -> the re-raise row withdrawn (merged into <id>); target corroboration++
guard fail / anchor /    -> queued (reason_code); edit reverted via journal
  drift / needs-data
```
GATE (per round) = `node ledger.js gate` = 0 GATE-BLOCKING active major, where GATE-BLOCKING =
{raised, in-trial, re-trial, valid-fixable}. author-required / queued / dropped / closed are
gate-ok. `node ledger.js unadjudicated` (active major with no verdict) must be empty too:
budget exhaustion or a stalled trial cannot fake completion.

## Outer loop (一审 -> ... -> n审 -> 终审) + clerk convergence

Each 审 = one inner round on the CURRENT edited paper. CLEAN ROUNDS: the reviewer-facing
steps (assign/read/coverage) never see the ledger or prior open questions (max
decorrelation; a clean re-review IS the "did the edit fix it" test; an independent
re-raise = corroboration). Only the deterministic spine carries into core steps.

The clerk reconciles each clean round into the single cumulative ledger via a
DETERMINISTIC merge key (passage_id match AND the clerk's same-issue confidence >=
threshold; borderline -> genuinely-new, recall-safe). author-required ACCUMULATES across
rounds (no per-round human interrupt); 终审 = the human handles the queue in one pass.

TERMINATION (stop on the first):
- clerk CONVERGENCE: `genuinely_new_count == 0 && new_closures_count == 0 &&
  new_author_required_count == 0`.
- APPLIED-QUIESCENCE backstop: K consecutive rounds with 0 applied edits (K = dryStop).
- HARD LIMITS: `max_rounds` (intensity) / optional wall-clock / AFK ceiling H hours. On a
  hard stop with majors still active, flip them to `queued` so the gate winds down clean.

## Robustness / batching / model
- Per-charge IDEMPOTENT retry keyed on the ledger (which charge_id still lacks a verdict);
  charge-less phases (clerk, coverage-auditor, merge) retry by `(phase, round)` and re-run
  wholesale. A re-run never re-judges an already-adjudicated charge.
- Canary batch (3-5) before any large run; Monitor watchdog (~90s no-progress) -> kill, back
  off (Monitor until-loop), re-run the failed sub-batch.
- PHASE-BOUNDED batching: stay within a phase; the trial phase splits into same-phase
  invocations when charges x agents-per-charge exceeds ~600 (charges/invocation = floor(600 /
  (jury_size + 2))); tier-12 escalations re-batched the same way.
- Sustained rate-limit: canary-heartbeat pause/resume; K-consecutive-failed-canary ->
  queue-notify + pause; hard ceiling H hours -> wind down to the queue.
- Concurrency 16 automatic/invocation; 1000-agent cap PER invocation; /goal hosts a SEQUENCE
  of invocations; never run concurrent top-level workflows.
- Model: all engine agents Opus 4.8 (inherit or `model:'opus'`; NO haiku). Effort session-level.

## Intensity -> args
| intensity | reviewers N | tier-1 / escalate jury | context expansions | recall skeptics | dryStop (applied-quiescence K) | max_rounds |
|---|---|---|---|---|---|---|
| light    | 2-3 | 5 / 12 | 1 | 1 | 1 | 2 |
| standard | 3   | 5 / 12 | 2 | 1 | 2 | 3 |
| thorough | 3-4 | 5 / 12 | 2 | 2 | 2 | 4 |
Safety envelope invariant: anchors never auto-edited; edit-safety on every risky edit; recall
always runs; never-drop; deterministic gate + clerk convergence.

## Review v3 vs auto
Same engine. REVIEW: step 13 needs per-edit sign-off; the polish track becomes an author
CHECKLIST (queued, polish-review); meaning/edit-audit advisory; step 14 stops (no auto-advance).
AUTO: edits apply under the bounded-aggressive + edit-safety rule (LOW applies, RISKY/anchor/
drift queues); the polish track applies LOW non-anchor + queues RISKY; every human gate becomes
a `queued` row; the outer loop runs under `/goal` until clerk convergence / applied-quiescence /
a hard limit, then the gate flips PASS. See `auto-mode.md`.

## Build deviations from the rev.2 spec (as actually built)
- `merge.workflow.js` is a SEPARATE file (rev.2 §6 folded merge into reading-check); it runs
  AFTER the anti-skim loop, so it must be its own step.
- the juror local-context unit selection is INLINED in `trial.workflow.js` (no separate
  `units-for-charge.js`).
- `meaning-audit.workflow.js` is KEPT SEPARATE (frozen anchors); `edit-audit.workflow.js` is the
  non-anchor risky-edit half. They are two workflows, not one folded file.
