# Auto mode — design rationale (v0.7; engine + envelope BUILT 2026-06-01)

Status: design v0.7 (2026-06-01). This doc is the RATIONALE; the operational protocol
is `references/auto-mode.md`. BUILT: the v3 engine auto runs on, the spine + four-state
meaning audit, and the deterministic safety-envelope helpers (`journal.js`
passage-rounds / within-cap / applied-in-round; `ledger.js gate`). NOT yet run
end-to-end on a real paper (a `/goal` dry-run is the remaining step). A third mode for
unattended / AFK runs, driven by Claude Code's `/goal`.

## 0. What auto mode is

A third mode alongside `direct-edit` (common) and `review` (occasional):

- **auto** = run the review-revise loop unattended toward a verifiable goal,
  applying safe fixes without per-edit sign-off, queueing the risky ones.

**Auto's inner review engine IS review-engine v3** (the courtroom per-issue
adjudication engine; see `REVIEW_ENGINE_V3_DESIGN.md`). Auto = the v3 engine run unattended:
it removes the human 2nd instance and routes every human gate (referrals, grounded
appeals, recall-auditor escalations) to the return queue. NOTE: the §9 dials below
are a PRE-v2 sketch (panel-era) that need re-derivation for v2's structure at
build; the §9 PRINCIPLE (intensity scales recall only, budget not wall-clock,
safety envelope invariant) is engine-agnostic and stands.

The hard problem auto must solve is not "how to run unattended" (Claude Code
already supports that). It is that **the reviewer↔author loop drifts** once you
remove the human from each round.

## 1. The drift problem (why naive auto is unsafe)

Observed failure (and a named, studied phenomenon):

```
reviewer (harsh) -> many micro issues, incl. nits, each anchored only locally
author -> binary accept/reject per issue
accept a micro issue -> a local edit; no global anchor -> local "fixes" erode the core
each round re-freezes the changed text -> new micro issues -> never converges
net: core claims drift semantically; the paper becomes 面目全非
```

Literature names it: **semantic drift** (meaning/attribution shifts after AI
rewriting) and **non-monotonic convergence** from cascading edits + audit-scope
expansion; **file-based cross-round state makes drift accumulate**. Three root
causes: (a) no immutable north-star anchor, (b) reviewer churns on nits, (c)
author is binary. Autonomy amplifies all three.

## 2. Anti-drift guardrails (the safe operating envelope)

Borrowed: anchoring ideas from PaperSpine (`confirmed_motivation`,
`claim_register`, `logic_transfer_audit`); PaperSpine is a forward
generate/rewrite tool with NO adversarial loop, so we take its ideas and bolt
them onto our loop. The literature supplies the rest.

| # | Guardrail | Treats | Source |
|---|---|---|---|
| **A+B** | **Spine = 7 anchor sentences** (frozen) + a **meaning audit** that re-checks them each round AND cumulatively vs round-0 | claim/argument drift | PaperSpine logic-transfer-audit (7-anchor test) |
| **C** | **severity floor / nit suppression**: auto acts only on blocker/major; minor/nit are logged and batched, never auto-edited. Reviewer told to favor substance | the churn source | our severity + literature (audit-scope expansion) |
| **E** | **convergence guard**: per-passage edit-count limit + oscillation detection (same issue re-surfacing) + hard max-rounds | non-monotonic convergence | our churn note + /goal evaluator |
| **F** | **minimal-edit, intent-preserving author policy**: smallest edit that meets the close_criterion AND preserves the surrounding claim; if it can't be fixed without changing a registered claim's meaning, do NOT auto-fix, queue it; reviewer over-reach -> refine the criterion, not full-accept | binary author | PaperSpine rationale-matrix + our toolkit guards |

### The spine, concretely (A+B unified)

The "spine" IS the 7 anchor sentences from PaperSpine's logic-transfer audit:

1. Abstract motivation sentence
2. First Introduction problem sentence
3. Main gap sentence
4. Final Introduction contribution / roadmap sentence
5. First Methods rationale sentence
6. First Results headline finding
7. First Discussion answer sentence

These should form one coherent problem -> solution -> evidence -> resolution
arc. The meaning audit (B) checks, each round and cumulatively vs round-0, that
no anchor's MEANING drifted and the arc is unbroken. A failing edit is rejected
and queued, not applied.

**Anchors are never auto-edited (decided 2026-05-31).** Any fix that would touch a
spine anchor sentence is ALWAYS queued, never auto-applied (anchors are the
highest-stakes sentences; same rule as the spine-overlap nit exclusion). So the
meaning audit's real job is NOT to gate direct anchor edits (those are queued by
rule); it is to catch INDIRECT drift: a non-anchor edit (a supporting sentence, a
definition, a result) that makes a frozen anchor no longer hold.

**The audit's verdict space (four states, per anchor, per round).** Judged against
the frozen anchor + the current supporting text:

| verdict | meaning | action |
|---|---|---|
| `holds` | anchor still true and still supported by current text | pass |
| `weakened` | the anchor's commitment is softened (wording or support weaker) | roll back the causing edit(s), queue |
| `contradicted` | current text directly conflicts with the anchor | roll back, queue |
| `now-unsupported` | anchor still stated, but the evidence that backed it was edited away | roll back, queue |

`weakened` and `now-unsupported` are kept SEPARATE (decided): a softened claim and
a claim whose support vanished are different failures needing different human
calls. Any of the last three verdicts rolls back the EDIT that caused it (never the
anchor) and queues it with before/after. The deterministic anchor-diff (section 3)
pre-filters which anchors' support regions changed, so the semantic agent only
judges the anchors that could have moved.

### Decision: NO token-budget "drift budget" (former guardrail D)

A quantitative cap on how much a passage may change (token %) was considered and
**dropped**. Reasons: (1) it overlaps A+B, which already bound the real harm
(meaning drift); (2) token % is a crude proxy that false-positives on legitimate
heavy-but-faithful rewrites; (3) the genuine residual risk (small drifts
accumulating below per-round detection) is better caught by making B
**cumulative against round-0**, plus E's deterministic **edits-per-passage
counter**. So D's goal is covered by cumulative-B + a counter, with no fuzzy
threshold to tune.

## 3. Mechanism split: deterministic scripts vs semantic agents

PaperSpine's pattern: offload the checkable steps to deterministic Python
scripts (`artifact_check.py`, `citation_bank_check.py`, `latex_guard.py`), keep
the model for judgment. We borrow this BECAUSE under unattended runs a guardrail
that is itself a model self-judgment can also drift. So:

- **Deterministic scripts** (run the same every time, trustworthy AFK):
  extract the 7 anchors and diff original vs current; the edits-per-passage
  counter; oscillation detection (an issue re-appearing); the severity floor
  filter; LaTeX-compile guard.
- **Semantic agents** (genuine judgment, kept model-side): "did this anchor's
  MEANING drift vs the frozen spine"; the reviewer panel; the edit drafting.

So from PaperSpine we borrow TWO things: the anchoring ideas (section 2) AND this
script-for-checkable-guards mechanism (more important for auto reliability).

## 4. Spine establishment (the confirmation step at auto start)

Auto usually starts from a half-finished draft: abstract/intro likely exist,
results/discussion may not. So:

1. Auto-extract a DRAFT spine from the existing text plus a review of the
   discussion history. The 7 anchor TYPES are a CHECKLIST, not a quota (decided
   2026-05-31): the spine is whatever real anchor sentences exist (could be 4, 5,
   or 7). Do NOT force-fit to 7, and never invent a missing anchor (inventing a
   results headline would be fabrication).
2. Anchor types with no real sentence yet (often the results headline / discussion
   answer in an early draft) are marked `not-yet-written` candidates: tracked, not
   frozen.
3. Present the concrete extracted anchors to the author; modify or accept.
4. On accept, FREEZE the existing anchors for the run. (This is the one human input
   auto needs up front; everything after runs against this partial frozen spine.)

**Filling a missing anchor during the run.** If auto drafts text that would fill a
`not-yet-written` slot, that text is ALWAYS QUEUED, never auto-frozen as an anchor. Auto may draft
such a fill ONLY from material that already exists; if the slot needs data or
results that do not exist yet (e.g. a results headline before the experiments are
run), it queues a `needs-human-input` note, never a fabricated figure.
There is no live "ask" in auto (AskUserQuestion is dead headless), so the "should
this become a frozen anchor?" question degrades to a queue entry the author
resolves on return; only the author's approval promotes a drafted slot to a frozen
anchor (on return, or interactively in a non-auto run).

## 5. The bounded-aggressive auto policy (reconciling moderate <-> aggressive)

The author wanted a range between moderate and aggressive: moderate alone does
too little (AFK feels pointless), aggressive alone mangles the core. The
guardrails make a single rule both aggressive-where-safe and hard-bounded:

> **Auto-apply a fix iff: (a) it addresses a blocker or major issue, (b) it
> satisfies the issue's close_criterion, (c) it passes the meaning audit (no
> anchor drift vs the frozen spine, arc intact), (d) the passage is within its
> rounds-touched / convergence limit, and (e) it does NOT edit a spine anchor
> sentence. Otherwise, QUEUE it.**

Aggressive on safe fixes (wording, polish, de-AI, captions, surfacing implicit
logic, contained major fixes) so auto does real work; hard-bounded by A+B+C+E+F
so core claims cannot drift, nits do not churn, and nothing runs away.

Always queued (never auto-applied): any fix that would edit a spine anchor
sentence (anchors are never auto-edited, see section 2), nits (batched), any fix
that would change a registered claim's meaning, any passage that hit its
rounds-touched limit.

## 6. /goal integration

- **Trigger**: explicit only. Auto never self-detects headless (no runtime
  signal exists). Opt in via `/goal` context or config `mode: auto`.
- **Operational stop = applied-quiescence (decided 2026-05-31)**: the loop stops
  after K consecutive rounds that produce ZERO applied edits (K = dryStop, by
  intensity 1/2/2). Any applied edit resets the counter. This is the true fixpoint
  of the APPLIED channel (the paper stopped changing). The QUEUE channel may still
  grow; that is expected and is NOT a termination requirement, because an
  adversarial fresh panel can always find one more thing to queue, so requiring
  queue-quiescence risks non-termination (death-by-nits redirected into the queue).
  Nice side effect: the last K dry rounds reviewed the STABLE final text, so the
  freshest queue entries are generated against the final paper.
- **Inner vs outer "dry"**: the reading-check's inner loop-until-dry stops on no new
  ISSUE (recall); this outer auto loop stops on no new APPLIED EDIT (convergence).
  Nested, different meanings, do not conflate. Nits do NOT count as applied edits
  (they are the terminal batch), so nit-queueing never keeps the loop alive.
- **Completion condition the evaluator checks (deterministic)**:
  `0 blocker and 0 major in ACTIVE ledger status`, ledger written this turn. By
  construction, after K dry applied-rounds the active blocker/major count is 0
  (every blocker is either applied-closed or queued-not-active), so this flips
  true. The SEMANTIC guards (meaning audit, rounds-touched cap, oscillation) are
  enforced by OUR loop and reflected INTO the ledger/queue (an unresolved drift
  becomes a queued issue, keeping the ledger non-clean until handled). This keeps
  the independent Haiku evaluator lightweight and trustworthy: it verifies a
  deterministic ledger fact, it does not re-run the semantic audit.
- **Hard stops**: `max_rounds` cap (2/3/4 by intensity), oscillation detection, and
  "blockers can only be cleared by queueing, not by editing past a limit" -> /goal
  cannot run away.
- **No AskUserQuestion in auto** (it errors with no human present). Every human
  gate becomes the pre-authorized policy (section 5) or a queue entry.
- **Permissions** pre-approved out of band (settings / `--permission-mode auto`).
- **/goal vs a chat "I'm AFK"**: build around `/goal` (verifiable condition,
  independent evaluator, multi-turn guarantee). Treat a plain "AFK" chat as a
  weaker fallback and nudge the user to `/goal` for real autonomy.

### /goal hosts a SEQUENCE of workflows (decided 2026-06-01)

- /goal drives the ORCHESTRATOR loop, not a single workflow. Across its turns the
  orchestrator runs the v2 invocation chain per round (decompose [det] ->
  reading-check [WF] -> screen [det] -> trials [WF] -> judgment + drafter [det] ->
  recall audit [WF] -> queue [det]), x outer rounds, until applied-quiescence +
  0 active blocker/major.
- The 1000-agent cap is PER workflow invocation, NOT per /goal session; each
  invocation has a fresh budget. So one /goal run hosts MANY sequential
  invocations, none approaching 1000.
- **Per-invocation batching (hard rule).** Keep each single workflow invocation
  under a safe ceiling (`MAX_AGENTS_PER_WF` ~ 600, ~40% margin below 1000). Size
  each phase's batch from agents-per-item (e.g. trials at ~13 agents/charge ->
  ~45 charges/invocation; reading at units x lenses x loop). Split a phase across
  sequential invocations when its work-list exceeds the ceiling.
- Parallelism lives INSIDE each workflow (the min(16, cores-2) fan-out: 12 jurors,
  units x lenses); multiplicity / sequence lives in the /goal-driven orchestrator
  loop. Do NOT run concurrent top-level workflows (harness support unverified +
  would oversubscribe the 16 cap).
- Build-time verify: exact behavior at the 1000 cap (hard error vs silent cap),
  and whether /goal can stop the loop while a background workflow is in flight
  (mitigation: the orchestrator only lets the completion condition read true after
  a full round's ledger update, never mid-flight).

## 7. What comes back to you (the queue)

An auto run returns, for one human pass on return:

- **Applied**: the low/medium-risk, meaning-preserved fixes that landed.
- **Queue (reconciled)**: drafted-but-not-applied patches for {anchor-touching
  fixes, claim-meaning-change fixes, batched nits, non-converging passages,
  compile-failed fixes, needs-human-input}, each ready to approve/reject in one
  sitting. See the queue lifecycle below.
- **Drift report**: each anchor before vs after, plus the meaning-audit verdicts
  (the four-state table), so you can confirm the core did not move.

### Queue lifecycle (decided 2026-05-31)

The queue is patches and issues drafted against a MOVING document, so it is
managed, not just appended. Two gates keep it honest:

- **Dedup-at-enqueue.** Before adding an entry, check it against the open queue by
  `passage-id` + overlapping issue meaning; merge duplicates instead of piling
  them. Each entry carries `{passage-id, issue, reason-code, optional drafted
  patch, round-created}`. reason-code in {anchor-touching, hit-passage-cap,
  claim-meaning-change, batched-nit, compile-failed, needs-human-input}. Queued
  entries are INERT during the run (never auto-apply, never trip guards). This
  dedup is also what lets the applied-quiescence loop terminate without the queue
  counter exploding.
- **Wind-down reconciliation (once, against the FINAL text).** For each open entry:
  resolve its `passage-id` (gone -> relocated / dropped-with-reason); check the
  issue is still live against the final text (mooted by a later edit -> drop with a
  logged reason); test the drafted patch still applies (no longer -> re-draft
  against final text); re-tag severity; final dedup. Bucket into: **live**
  (actionable) / **dropped-with-reason** (collapsed to one line each, with the
  reason) / **re-drafted** (re-fitted to final text).

**Iron rule: never silently drop a queued item.** Either it comes back alive
(possibly re-drafted), or it is dropped WITH a logged reason. "Not in your action
queue" must mean "deliberately resolved or mooted, here is why", never "lost".
Reconciliation only cleans / dedups / re-drafts / drops-with-reason; it NEVER
auto-applies. The human still signs off on every survivor.

### Per-edit revertability (decided 2026-05-31)

Every auto-applied edit is recorded as its own atomic, reversible unit, so on
return the author can undo ANY single edit without disturbing the others (you may
dislike edit #7 of 15 and want only that one gone).

- **Append-only patch journal** (always; git-independent, so the skill stays
  generic): per applied edit, log `{passage-id, before-text, after-text, the issue
  + close_criterion it served, round}`. The issue/criterion field is a one-line
  rationale per edit (the one thing worth borrowing from PaperSpine here: its
  auditable-rationale trail; PaperSpine itself has NO per-edit undo because it is a
  forward staged pipeline, not an unattended loop, so it never accumulates many
  autonomous edits). To revert an edit, re-apply its before-text.
- **Optional git commit per edit** when the project is a git repo, giving
  `git revert <that edit>` for free.

REUSED, not new: the compile-guard already needs single-edit rollback (a fix that
breaks compilation is rolled back), so the journal just exposes that same per-edit
revert to the author at return time.

## 8. Resolved decisions (locked 2026-05-31)

The four §8 open items were decided in discussion. Numbers are DEFAULTS,
overridable by a project config; the bias is conservative because auto runs
unattended.

**Convergence limits (guardrail E).**
- Outer `max_rounds`: adjustable by intensity (2 / 3 / 4 for light / standard /
  thorough; default 3). See §9. Backstop only; the real stop is the completion
  condition (0 blocker / 0 major in ACTIVE ledger status). Reaching the cap still
  raising blocker/major means the paper needs a human, not more autonomous churn.
  Safe to raise because the real per-passage drift bound is the rounds-touched cap
  below (fixed at 2), which never moves; more rounds only spreads work across MORE
  passages, never lets one passage drift further.
- Per-passage limit counts ROUNDS-TOUCHED, not raw edit count. Cap = 2, FIXED
  across all intensities (this is the real drift bound): a passage may be edited in
  at most 2 distinct rounds, then any further change to it is queued. Rationale: drift's signature is the same passage edited across many
  rounds (each round's fix spawns the next round's issue); closing two distinct
  issues on one passage WITHIN a round is density, not drift, and a raw-count cap
  would wrongly block it.
- Oscillation is a separate, count-independent trip: a closed issue's
  close_criterion re-surfacing (judged by meaning) freezes that passage and queues.

**Passage identity (prerequisite for the per-passage counter).**
A passage's cross-round ID = `section path + in-section paragraph ordinal + hash
of the nearest stable anchor` (a `\label`, else the first N stable words). Needed
because the text changes each round, so neither exact text nor a bare ordinal
survives an edit. The deterministic counter / oscillation guard keys on this ID.

**Nits: Option B (terminal batched pass), not pure-queue.**
Nits accumulate but are NOT applied during rounds (so they never enter the loop).
After the substantive loop terminates, one one-shot batch applies them, runs the
meaning audit once, and freezes WITHOUT re-review (the no-re-review timing is what
breaks the nit spiral by construction). Exclusion: any nit whose locus overlaps a
frozen spine anchor is pulled from the auto-batch and queued instead. The terminal
batch runs INSIDE the run, before declaring done, so /goal does not stop at
0 blocker/major before the nits land. Pure-queue (A) stays available as the
strictly conservative fallback. The script-verified-auto / judgment-queue split
(C) is deferred.

**Deterministic guards: staged by criticality, orchestrator-side.**
Architecture fact: the Workflow JS sandbox has no filesystem and no subprocess, so
the deterministic guards CANNOT run inside the workflow. They are ORCHESTRATOR-side
tools invoked via Bash between workflow calls; the workflow does fan-out only.
- v1 real scripts (a model cannot substitute; load-bearing for autonomy safety):
  (1) spine anchor-diff locator. Anchor EXTRACTION is a one-time semantic step at
  spine freeze (section 4); the per-round DIFF (locate each frozen anchor, report
  changed/unchanged + new text) is deterministic and lets the meaning-audit agent
  judge only the anchors that actually changed. (2) compile / structure guard:
  actually run the LaTeX compiler after each auto edit; detect-or-degrade to a
  structural lint (brace / env balance, no new undefined refs) when no toolchain.
- Inline first (promote to a script only if a second consumer appears): the
  severity floor (a one-line filter on the severity enum) and the per-passage
  rounds-touched counter + oscillation check (ledger bookkeeping).

**max-rounds terminal state (avoids a /goal deadlock).**
On hitting `max_rounds` with blocker/major still open, TRANSITION those to status
`queued` (not closed). This zeroes the ACTIVE blocker/major count, so the /goal
completion condition flips true and the run winds down cleanly, with the unfixed
issues sitting in the return queue (each noted, e.g. "needs new experiment").

**Remaining build tasks (not decisions):**
- Adapt PaperSpine's `logic-transfer-audit` 7-anchor mechanism into the per-round
  meaning-audit agent (mechanism already fetched and read this design session).
- When wiring auto into `SKILL.md`, add an explicit carve-out to hard rule 1: the
  rule HOLDS; auto satisfies it via up-front policy sign-off (§4 spine confirm +
  §5 policy) plus the queue, not per-edit sign-off. (The mechanism is already
  designed across §4/§5/§6/§7; this is only the documentation carve-out so a reader
  does not think rule 1 is silently broken.)
- ~~RE-DERIVE §9's intensity dials for v2's architecture~~ **DONE 2026-06-01
  (D-04 resolved)**: §9 now carries the v2 knob set (reading loop-until-dry +
  lenses, grand-jury screen agents, trial-jury size/diversity, recall-auditor
  skeptics, appeal scope, completeness-critic, outer max_rounds). The §9 principle
  and safety envelope are unchanged; two v2 invariants were added (grand-jury low
  bar; recall auditor always runs on every drop).

## 9. Intensity presets (decided 2026-05-31)

> **STALE (pre-v3):** the dial table below predates the v3 engine and still names
> v2-only machinery (grand-jury screen, reading loop-until-dry) that v3 removed.
> Pending re-derivation against `review-engine-v3.md` Inventory. The §9 PRINCIPLE
> (intensity scales recall only, never the drift-safety envelope) is engine-agnostic
> and still holds.

> RE-DERIVED FOR v2 (2026-06-01, D-04 resolved): the dial table below is now the v2
> knob set (reading loop-until-dry + lenses, grand-jury screen depth, trial-jury
> size/diversity, recall-auditor sensitivity, appeal scope). The panel-era dials it
> replaced (reviewer count N, inner dryStop/maxRounds, verify angles) are gone. The
> orchestrator resolves the intensity to these values and passes them as the v2
> workflows' args. The PRINCIPLE is engine-agnostic and unchanged.

Auto takes an intensity setting. The load-bearing rule: **intensity scales only
the recall / thoroughness dials; it never touches the drift-safety envelope.**
High intensity finds issues WIDER and DEEPER; it does not let the paper move
further. If intensity could relax the safety bounds, "high intensity" would mean
"higher drift risk" and the whole design premise collapses.

**Invariant across all intensities (the safety envelope):**
- per-passage rounds-touched cap = 2 (the real drift bound)
- spine anchors never auto-edited (always queued)
- meaning audit runs every round
- the bounded-aggressive apply rule (only blocker/major, criterion met, audit
  passed, within limits)
- the grand-jury screen keeps its LOW probable-cause bar (the recall floor);
  intensity scales how many light screen agents run, NEVER the bar to pass
- the recall auditor ALWAYS re-checks EVERY drop; intensity scales only its skeptic
  count, never whether it runs (recall is non-negotiable)

**Scaled by intensity (recall / thoroughness):**

| dial (v2 knob) | light | standard | thorough |
|---|---|---|---|
| reading loop-until-dry (dryStop) | 1 | 2 | 2 |
| reading lenses per unit | 3 | 3 | 4 |
| grand-jury screen agents | 1 | 2 | 3 |
| trial-jury size (decorrelated) | 6 | 9 | 12 |
| recall-auditor skeptics per drop | 1 | 1 | 2 |
| appeal scope | grounds-only | grounds-only | grounds-only |
| completeness-critic pass | off | off | on |
| outer max_rounds | 2 | 3 | 4 |

Why these dials and not others: the trial jury is worth its size ONLY if jurors are
DECORRELATED (distinct lenses/framings); a 12-identical jury approximates a 5-juror
one, so size scales WITH diversity (light 6, standard 9, thorough 12 distinct
framings), never raw count alone. The grand-jury screen agents scale the breadth of
the cheap pre-trial filter, but its bar stays low (recall). The recall auditor's
skeptic count is the only recall-side dial allowed to start at 1, because it runs on
EVERY drop regardless. Appeal scope is fixed at grounds-only at all intensities (an
ungrounded appeal is noise, not thoroughness).

`outer max_rounds` IS in the scaled set (decided): raising it is safe because the
real per-passage drift bound (rounds-touched = 2) never moves, so more rounds only
spreads work across more passages, never lets one passage drift further.

**Demarcation is by token budget, NOT wall-clock.** Wall-clock is neither
predictable nor enforceable here (agent latency / queueing / parallel-cap
variance; `Date.now()` is unavailable in workflow scripts) and does not map to
drift. The native, measured resource is the token budget (`budget.total` /
`budget.remaining()`), which the workflow already respects (it stops early when
low). The three presets are user-facing as "how long you're away" (quick pass /
standard / overnight) but map under the hood to a token-budget ceiling plus the
recall dials above. A wall-clock figure may be surfaced as a soft estimate only,
never as a hard control.

## Changelog
- 2026-06-01 v0.7 (BUILD): §9 intensity dials RE-DERIVED for v2 (D-04 resolved):
  panel-era dials (reviewer-N / inner dryStop+maxRounds / verify-angles) replaced by
  v2 knobs (reading loop-until-dry + lenses, grand-jury screen agents, trial-jury
  size/diversity, recall-auditor skeptics, appeal scope); two v2 invariants added to
  the safety envelope (grand-jury keeps its low recall-bar; recall auditor always
  runs on every drop). Engine core built + verified this session (ledger/journal/
  decompose/anchor-diff/compile-guard/spine scripts + the meaning-audit workflow).
- 2026-06-01 v0.6: aligned auto to review-engine v2 (auto's inner engine IS v2,
  §0); recorded the /goal-hosts-a-sequence-of-workflows model + the per-invocation
  agent-batching rule (`MAX_AGENTS_PER_WF` ~600; the 1000-cap is per-invocation,
  NOT per-/goal); §9 dials flagged as a pre-v2 sketch needing re-derivation for v2
  at build (the §9 principle stands). Resolves cross-check finding D-04.
- 2026-05-31 v0.5: per-edit revertability added (§7): append-only patch journal
  (passage-id + before/after + the issue/close_criterion it served as a one-line
  rationale, echoing PaperSpine's auditable trail; PaperSpine has no per-edit undo
  itself) + optional git-commit-per-edit, reusing the compile-guard's single-edit
  rollback. §4 fill rule tightened: auto drafts a missing-anchor fill only from
  existing material, queues `needs-human-input` when data/results do not yet exist,
  never fabricates.
- 2026-05-31 v0.4: spine made PARTIAL-friendly (§4): the 7 anchor types are a
  checklist not a quota, do not force-fit; missing types are `not-yet-written`
  candidates, tracked not frozen; auto may draft a fill but it is QUEUED, promoted
  to a frozen anchor only on author approval (no live ask exists headless). #2
  (hard-rule-1 reconciliation) reclassified: not an open decision, the mechanism
  already exists (§4/§5/§6/§7); only a build-time SKILL.md carve-out remains, now a
  build task in §8.
- 2026-05-31 v0.3: anchors never auto-edited (all anchor-touching fixes queued);
  meaning audit given a four-state verdict space (holds / weakened / contradicted /
  now-unsupported; weakened and now-unsupported kept SEPARATE), its real job is
  catching INDIRECT drift, a failing verdict rolls back the CAUSING edit not the
  anchor. Termination operationalized as applied-quiescence (K consecutive
  0-applied rounds), NOT queue-quiescence; inner-vs-outer "dry" distinguished;
  evaluator checks the deterministic ledger fact only, semantic guards enforced by
  the loop and reflected into the ledger/queue. Queue lifecycle added
  (dedup-at-enqueue + wind-down reconciliation vs final text + three buckets +
  never-silently-drop).
- 2026-05-31 v0.2: intensity presets added (light / standard / thorough).
  Principle: intensity scales recall/thoroughness only, never the drift-safety
  envelope. Demarcation by token budget, not wall-clock (not predictable or
  enforceable here). Outer `max_rounds` moved into the scaled set (2/3/4); the
  per-passage rounds-touched cap stays fixed at 2 as the real drift bound. See §9.
- 2026-05-31 v0.1: §8 open items resolved. `max_rounds=3` (backstop);
  per-passage limit = 2 ROUNDS-touched (not raw edits) + independent oscillation
  freeze; passage-id = section + ordinal + anchor-hash; nits = Option B (terminal
  one-shot, no re-review, spine-anchor-overlap excluded); guards staged by
  criticality and orchestrator-side (sandbox has no fs) with anchor-diff +
  compile/structure-guard as v1 scripts, severity-floor + counter inline;
  max-rounds terminal state transitions leftover blocker/major to `queued` to
  avoid a /goal deadlock.
- 2026-05-29 v0: auto as 3rd mode; drift problem + named literature; guardrails
  A+B(7-anchor spine + meaning audit) / C / E / F; D (token budget) dropped,
  folded into cumulative-B + counter; script-vs-agent split; spine confirmation
  flow; bounded-aggressive policy; /goal integration; queue-on-return.
