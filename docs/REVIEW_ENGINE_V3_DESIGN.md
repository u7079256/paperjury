# Review engine v3 (DESIGN RATIONALE; BUILT; supersedes the v2 prosecution)

Status: BUILT and cross-checked. The operational protocol + every seam contract is
`references/review-engine-v3.md`; the ledger contract is `references/ledger-schema.md`;
the personas/assignment are `references/reviewer-personas.md`; the auto loop is
`references/auto-mode.md`. v3 KEEPS v2's deterministic+semantic layering, ledger/journal/
spine, three-way routing, and recall-audit; it REPLACES v2's prosecution (a per-unit-x-lens
flood) with N holistic reviewers, ADDS a contestability-routed adjudication with a polish
track and a risk-proportional edit-safety guard, and makes the AFK multi-round loop converge
via a deterministic clerk. The engine's novel core has NOT yet been validated on a real paper
(see "Still unvalidated").

## 1. Why v3: the problem v2 hits at full-paper scale

v2 was designed and tuned on a single planted-flaw passage. Run on a whole paper for the
first time, the binding constraint flips: reviewer ATTENTION, effectively free at one-passage
scale, is SCARCE at full-paper scale, and v2 had no mechanism to manage it. Symptoms, all from
one root (no triage, no budget):

- The prosecution (`reading-check`) ran one agent per (unit x lens) under loop-until-dry. On a
  dense full paper this FLOODED (a real run produced 255 charges, the loop never went dry).
- Cost scaled with CANDIDATE issues, not REAL issues: the ~12-juror trial (each juror fed the
  WHOLE paper) sat downstream of a cheap-but-unbounded generator, so a full-paper trial demanded
  thousands of agents.
- Zero fault tolerance: under a transient rate-limit, schema-forced agents complete without
  emitting StructuredOutput and a whole batch returns empty. One blip = total loss.

Diagnosis: the real trilemma is precision-recall-COST. v2's "recall is non-negotiable" stance
(loop-until-dry, bias-to-indict, bias-to-revive) is right for a single passage but, scaled by
brute multiplication, removes every governor on attention. v3 reintroduces the governor at
GENERATION (do not produce a flood) and at ADJUDICATION (spend deep deliberation only where it
changes the answer), and guards edits by risk.

## 2. Generation: N domain-expert HOLISTIC reviewers

Replace "gatekeeper core x 3 generic methodology lenses x per-(unit x lens) x loop-until-dry"
with a model faithful to real peer review:
- **Exactly N reviewers (default 3, range 2-4), each HOLISTIC**: one agent reads the WHOLE paper
  and files ONE report. Differentiated by professional DOMAIN / subfield, not methodology axis.
- **Shared persona core = the project-provided gatekeeper** + a per-reviewer DOMAIN OVERLAY,
  instantiated by a cheap, HUMAN-CHECKABLE `assign-reviewers` step (config-pin / verifier /
  per-slot degrade headless). Never hardcoded.
- **Minimal signals**: per weakness, `significance(major|minor)` + `kind(mechanical|substantive)`
  + a verbatim quote + optional references; per reviewer, ONE `overall_confidence`. REMOVED:
  per-issue confidence, blocker, nit, the triage agent, the single organizer, the grand-jury
  screen, MAX-confidence routing.

### 2a. Preserving the v2 fan-out's two real benefits
The fan-out served anti-skim and anti-drift; v3 decouples them.
- **Anti-drift** only needs the passage_ids to EXIST; `decompose.js` still emits them (the
  anti-drift substrate + the canonical section list + the juror local-context source), but is
  no longer the reading unit.
- **Anti-skim** is preserved by three layers: (L1) each reviewer must account for EVERY section
  with an in-section verbatim quote, deterministically quote-verified, miss -> cap-1 re-invoke;
  (L2) one `coverage-auditor` flags skimmed (reviewer, section) pairs incl. cross-reviewer
  disagreement; (L3) a flagged pair -> cap-1 re-invoke. A CS paper's prose is a modest token
  count, so one careful holistic read is appropriate; if a body ever exceeds a single read
  budget, partition sections across the N reviewers (never a unit x lens explosion).

Effect: bounded, peer-review-realistic generation; holistic readers catch cross-section
inconsistencies natively; the merge dedups across reviewers (significance MAX, kind
substantive-dominates, corroboration = raised_by_count, NEVER feeding significance).

## 3. Adjudication: routing by CONTESTABILITY

After merge + ledger intake (status `raised`), a deterministic router:
- `kind=mechanical` (any) -> polish track.
- substantive & minor -> polish track.
- substantive & major -> the 5-tier (trial).

### 3a. The 5-tier (trial)
- DEFENSE gets WHOLE-PAPER context -- this recovers the deleted grand-jury's "addressed
  elsewhere" catch, distilled into the trial.
- 5 decorrelated jurors get LOCAL context (the deterministic anchor-unit + the claim spine +
  any referenced unit); juror-local is the QUALITY choice (focused, anti-distraction), not just
  cost. The framing set always includes the most-hostile + most-charitable decorrelators.
- On-demand context expansion: a juror returns `context-limited` + `need`; the orchestrator
  re-invokes it with the requested part (cap 2). Judgment is never forced on insufficient context.
- The verdict is mostly DETERMINISTIC: decide iff quorum (surviving votes >= ceil(0.8*jurySize))
  AND a side > 60% of surviving votes; decided-invalid -> invalid-drop; decided-valid -> a JUDGE
  agent routes valid-fixable (close_criterion satisfiable by editing existing text) vs
  author-required; undecided at tier-5 -> `escalate` (orchestrator re-runs @ 12); undecided at 12
  or all-context-limited -> author-required.
- `recall-audit` then (Mode A) revives wrong drops and (Mode B) spot-checks strong-consensus
  valid-fixable majors BEFORE the edit, with a fresh skeptic decorrelated from the jury (guards a
  correlated-wrong consensus); unsound -> author-required.

### 3b. The polish track (off-gate, never-drop)
mechanical -> a batch copy-edit; minor-substantive -> a batch light-check (drop-invalid with a
recall backstop / small edit / escalate-to-trial if actually major / flag for the author). All
polish edits feed the same edit-safety guard; in review the track is an author checklist.

### 3c. Edit-safety (risk-proportional; all edits)
A deterministic pre-filter (`anchor-diff` + `cross-ref`) classifies each drafted patch: LOW
(isolated) applies under compile-guard + journal; RISKY anchor -> `meaning-audit` (four-state +
arc); RISKY non-anchor -> `edit-audit` (make-sense + cross-section alignment, meaning-audit
generalized beyond the 7 frozen anchors). holds -> apply; drift -> revert + queue.

### 3d. The gate
GATE (per round) = 0 GATE-BLOCKING active major, where GATE-BLOCKING = {raised, in-trial,
re-trial, valid-fixable}. `author-required` is gate-OK (it accumulates in the human queue across
rounds, handled at 终审). `unadjudicated` (active major with no verdict) must also be empty:
budget exhaustion cannot fake completion.

## 4. The outer loop (一审 -> ... -> n审 -> 终审) + the clerk

Each 审 = one inner round on the current edited paper. CLEAN ROUNDS: the reviewer-facing steps
never see the ledger or prior open questions (max decorrelation; a clean re-review IS the "did
the edit fix it" test; an independent re-raise = corroboration). Only the deterministic spine
carries into core steps.

A single cumulative ledger persists; the CLERK (书记官) reconciles each clean round into it at
the round boundary via a DETERMINISTIC merge key (passage_id AND a same-issue confidence
threshold; borderline -> genuinely-new, recall-safe). This is the fix for "a semantic clerk
would be a hidden second source of truth": the agent only judges similarity; the merge GATE is
deterministic. CONVERGENCE (deterministic over the clerk's counts): genuinely_new == 0 AND no
new closures AND no new author-required -> goal reached. Backstops: applied-quiescence (K
zero-edit rounds) + hard limits (max_rounds / wall-clock / AFK).

## 5. Robustness / auto / model
Budget dissolved into rails (the ~600-agents/invocation batch + priority sort + the gate
terminator + never-drop); per-charge IDEMPOTENT retry keyed on the ledger; a canary batch + a
Monitor watchdog; phase-bounded batching; a sustained-rate-limit terminal policy. All engine
agents are Opus 4.8 (no Haiku); effort is session-level. Auto = this loop under `/goal` with the
bounded-aggressive + edit-safety apply rule and up-front spine + assignment sign-off; see
`references/auto-mode.md`.

## 6. Build checklist (as built; file-by-file)
DELETED: `workflows/grand-jury.workflow.js` (its catch -> the whole-paper DEFENSE).
REWROTE: `workflows/reading-check.workflow.js` (N holistic + weakness schema + coverage + targeted
re-invoke), `workflows/trial.workflow.js` (5-tier + local context + on-demand expansion +
deterministic quorum/escalate). NEW: `workflows/assign-reviewers`, `coverage-auditor`, `merge`,
`polish`, `edit-audit`; `scripts/cross-ref.js`. MODIFIED: `workflows/recall-audit` (Mode A+B),
`workflows/drafter` (tolerant unit match); `scripts/ledger.js` (significance/kind/tally/escalated
fields, gate = gate_blocking_major, re-trial status, escalate verdict, docket/unadjudicated,
legacy back-compat). UNCHANGED (verified roles): `workflows/meaning-audit` (frozen anchors),
`scripts/decompose/spine/journal/apply-patch/compile-guard/compliance-check`. DOCS:
`references/review-engine-v3.md` (NEW; the operational protocol + the orchestrator seam
contracts), `references/ledger-schema.md`, `references/reviewer-personas.md`,
`references/auto-mode.md`, this file.

The ORCHESTRATOR-side glue (the run harness, not a sandboxed file) carries the seam enrichments
(id->charge_id, reports->weaknesses flatten + reviewer_confidence, the consensus filter,
apply-patch enrichment from the ledger row, polish flagged -> queued, the clerk merge update,
the cross-ref/passages inputs to edit-audit), the outer-loop driver, and the retry/canary/
watchdog. All are documented in `references/review-engine-v3.md`.

As-built deviations from the design sketch: `merge` is a separate workflow (runs after the
anti-skim loop); the juror local-context selector is inlined in `trial`; `meaning-audit` is kept
separate (anchors) with `edit-audit` for non-anchor risky edits.

## 7. Provenance (how this was hardened)
The consolidated design was independently stress-tested by an adversarial validation workflow
(all OPEN design decisions endorsed; the failures were under-specified data contracts, since
fixed). The BUILT engine was then cross-checked by a second adversarial workflow (per cross-file
seam, with a fresh-skeptic verify of each finding); the confirmed code defects were fixed and the
orchestrator-seam contracts written into `references/review-engine-v3.md`. Precision comes from
the verify layer, not from agent count.

## 8. Still unvalidated (honesty)
The engine is BUILT, syntax-clean, unit-tested at the ledger, and cross-checked, but its novel
CORE has NOT been exercised end-to-end on a REAL paper: three-way routing accuracy on real
charges, the 5-tier behavior, the drafter/apply/edit-safety chain on real edits, anti-drift
gating, the clerk convergence, and the `/goal` auto loop. v3's purpose is to make that test
finally affordable and convergent; it does not by itself prove the core correct. The real-paper
validation run (resume from trial on the staged artifacts; P0/P1 locked) is the next milestone.
