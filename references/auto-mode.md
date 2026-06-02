# Auto mode -- the operational protocol (BUILT)

Auto = the review-engine v2 loop run UNATTENDED toward a verifiable goal, applying
safe fixes without per-edit sign-off and queueing the risky ones. Design + rationale:
`docs/AUTO_MODE_DESIGN.md`. Engine round: `references/review-engine-v2.md` (auto
variant). This file is the operational checklist.

## Entry (explicit only)
Auto never self-detects headless (no runtime signal). Opt in via `/goal` context or a
project config `mode: auto`. Permissions must be pre-approved out of band (settings /
`--permission-mode`). `/goal` is the real driver: a verifiable completion condition +
an independent Haiku evaluator + multi-turn auto-continue. A plain "I'm AFK" chat is a
weaker fallback; nudge the user to `/goal`.

## The one up-front human step
Before the unattended run, establish the spine (`references/spine.md`): extract draft
anchors, the author confirms, `spine.js freeze`. This is the only live human input
auto needs; everything after runs against the frozen partial spine. There is NO live
ask during the run (AskUserQuestion is dead headless), so every later human gate
becomes a queue entry.

## The bounded-aggressive apply rule (the whole policy in one line)
> Auto-apply a fix IFF: (a) it addresses a blocker or major, (b) it satisfies the
> issue's close_criterion, (c) the meaning audit holds (no anchor drift vs the frozen
> spine, arc intact), (d) the passage is within its rounds-touched cap (= 2), and
> (e) it does NOT edit a spine anchor sentence. Otherwise, QUEUE it.

Aggressive on safe fixes (wording, de-AI, claim-softening, captions, contained majors)
so auto does real work; hard-bounded by the spine + meaning audit + rounds-touched cap
+ minimal-edit drafter so the core cannot drift. Always queued: anchor-touching fixes,
claim-meaning-change fixes, nits (terminal batch), passages at their rounds-touched cap.

**Deterministic envelope checks (script, not model).** The drift bounds are
SCRIPT-checkable, not just policy. Before applying, the orchestrator runs
`node journal.js within-cap <journal.jsonl> <passage_id>` (exit 0 iff the passage is
below the rounds-touched cap of 2) and keeps only blocker/major valid-fixable verdicts
(the severity floor is a one-line filter). Applied-quiescence reads
`node journal.js applied-in-round <journal.jsonl> <round>` (0 applied edits for K
consecutive rounds = stop). These make the safety envelope auditable without trusting
the model's in-context bookkeeping (the residual-glue mitigation, D5).

## The round loop (under /goal)
Each round runs the v2 sequence (`review-engine-v2.md`) in the AUTO variant:
decompose `[det]` -> reading-check `[WF]` -> grand-jury `[det+WF]` -> trials `[WF]` ->
judgment + drafter + apply-under-guards `[det+WF]` -> recall audit `[WF]` -> queue
`[det]`. Repeat across rounds. The orchestrator hosts a SEQUENCE of workflow
invocations (the 1000-agent cap is per invocation; batch each under ~600).

## Termination = applied-quiescence (NOT queue-quiescence)
Stop after K consecutive rounds that produce ZERO applied edits (K = dryStop, by
intensity). Any applied edit resets the counter. The QUEUE may still grow; that is
expected and is NOT a termination requirement (an adversarial fresh panel can always
queue one more thing, so queue-quiescence risks non-termination). Nits do NOT count as
applied edits (they are the terminal batch), so nit-queueing never keeps the loop alive.
After the substantive loop, run the terminal nit batch (apply, one meaning audit, no
re-review), excluding any nit overlapping a frozen anchor (those queue).

## /goal completion condition (deterministic)
`node ledger.js gate <ledger.json>` -> PASS iff 0 active blocker AND 0 active major,
with the ledger written THIS turn. By construction, after K dry applied-rounds every
blocker/major is closed or queued (both non-active), so the gate flips PASS. The Haiku
evaluator checks this deterministic ledger fact; it does NOT re-run the semantic
audit (the semantic guards are enforced by our loop and reflected into the ledger as
queued rows). The orchestrator only lets the gate read true AFTER a full round's ledger
update, never mid-flight.

## max_rounds terminal state (no /goal deadlock)
On hitting `max_rounds` with blocker/major still open, transition those to `queued`
(not closed). This zeroes the active blocker/major count so the gate flips PASS and the
run winds down cleanly, with the unfixed issues sitting in the queue (each noted, e.g.
"needs new experiment").

## Queue lifecycle (managed, never silently dropped)
- **Dedup-at-enqueue**: before adding, check against the open queue by passage-id +
  overlapping issue meaning; merge duplicates. Each entry carries {passage_id, issue,
  reason_code, optional drafted patch, round}. Queued rows are INERT during the run.
- **Wind-down reconciliation (once, vs the FINAL text)**: for each open entry resolve
  its passage-id (gone -> relocated/dropped-with-reason), check it is still live
  (mooted -> drop with a logged reason), test the drafted patch still applies (no ->
  re-draft against final text), re-tag severity, final dedup. Bucket: live /
  dropped-with-reason / re-drafted. NEVER auto-applies; the human signs off survivors.
- **Iron rule**: never silently drop a queued item. It comes back alive (possibly
  re-drafted) or is dropped WITH a logged reason. `ledger.js set ... dropped` enforces
  a reason.

## What comes back (one human pass on return)
- **Applied**: the meaning-preserved fixes that landed (each revertable via the
  journal -- `apply-patch.js revert <J-id>` or `git revert` if a repo).
- **Queue (reconciled)**: live / dropped-with-reason / re-drafted, ready to
  approve/reject in one sitting.
- **Drift report**: each anchor before vs after + the four-state meaning-audit
  verdicts, so the author confirms the core did not move.

## SKILL.md hard-rule-1 carve-out
Hard rule 1 ("never edit the manuscript without explicit author sign-off") HOLDS in
auto. Auto satisfies it via UP-FRONT sign-off (the spine confirmation + the
pre-authorized bounded-aggressive policy) plus the return queue, not per-edit sign-off.
This is an explicit carve-out, not a silent exception: the author authorized the
policy and the envelope before the run; nothing outside the envelope is ever applied.
