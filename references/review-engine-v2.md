# Review engine v2 -- the orchestration protocol (BUILT)

The courtroom per-issue adjudication engine (design: `docs/REVIEW_ENGINE_V2_DESIGN.md`).
This file is the operational protocol: how the ORCHESTRATOR (the main session, driven
across turns by `/goal` in auto) sequences deterministic scripts and semantic
workflows into a round. The engine is shared by review v2 and auto; auto removes the
human 2nd instance and routes every human gate to the queue.

## Inventory (what runs)

Deterministic, orchestrator-side (Node, via Bash; the Workflow sandbox has no fs):
| script | role |
|---|---|
| `scripts/decompose.js` | split the manuscript into reading units + stable passage-ids |
| `scripts/ledger.js` | the JSON ledger + MD view; `gate` = the /goal completion fact |
| `scripts/journal.js` | append-only per-edit revert log |
| `scripts/apply-patch.js` | atomic apply + journal of a drafted patch, and revert (exact-once guard) |
| `scripts/anchor-diff.js` | locate frozen anchors, flag which need a meaning audit |
| `scripts/spine.js` | freeze the extracted anchors into spine.json |
| `scripts/compile-guard.js` | real LaTeX compile (or degrade lint); rollback signal |
| `scripts/compliance-check.js` | submission-readiness A deterministic checks |

Semantic, workflow fan-out (`workflows/*.workflow.js`; every one parses `args` as a
JSON string and carries the ISOLATION instruction):
| workflow | role |
|---|---|
| `reading-check` | prosecution: per-(unit x lens) charges + cross-unit + quote-verify, loop-until-dry |
| `grand-jury` | cheap low-bar screen; drop only obviously-invalid (Haiku) |
| `trial` | defense -> decorrelated jury -> judge; three-way routing |
| `drafter` | minimal-edit patch for valid-fixable charges (or honest text-softening / escalate) |
| `recall-audit` | fresh skeptic re-checks every drop; revive wrongly-dropped real issues |
| `meaning-audit` | four-state spine drift audit (advisory in review, gating in auto) |

## One round (orchestrator sequence)

`[det]` = a Bash/Node script step; `[WF]` = a Workflow invocation; `[human]` = a gate
(review) or a queue entry (auto); `[ledger]`/`[journal]` = a state write.

1. `[det]` **decompose**: `node decompose.js units <tex>` -> units. Passage mode: one unit.
2. `[det]` (auto, once) **spine**: extract anchors (agent) -> author confirm -> `node spine.js freeze`. Keep the round-0 frozen text as the cumulative baseline.
3. `[WF]` **reading-check**(units, personas, dryStop, maxReadRounds) -> charges (severity, section, summary, close_criterion, evidence_anchor, quote_verified).
4. `[det][ledger]` **intake**: `node ledger.js add` the charges as `raised`.
5. `[WF]` **grand-jury**(charges, units, screenAgents) -> {screened, dropped_obvious}. `dropped_obvious` go into the DROPS pool (not terminal yet; recall audit re-checks them).
6. `[WF]` **trial**(screened, units, spine, jurySize) -> verdicts. BATCH screened under `MAX_AGENTS_PER_WF` (~600 / ~14 agents per charge = ~42 charges per invocation; split across invocations). `[ledger]` per verdict: `valid-fixable` (status valid-fixable + judge close_criterion), `author-required` (status author-required), `invalid-drop` (-> DROPS pool).
7. `[WF]` **drafter**(fixable, units, spine) -> patches {before, after, touches_anchor, before_in_text, no_op}.
8. Per patch, apply under guards (review: per-edit sign-off first; auto: the bounded-aggressive rule):
   - if `no_op`/needs-human or `touches_anchor` -> `[ledger]` queue (status `queued`, reason_code `needs-human-input` / `anchor-touching`). Anchors are NEVER auto-edited.
   - AUTO deterministic envelope (before applying): keep the patch only if its severity is `blocker`/`major` (severity floor) AND `node journal.js within-cap <journal> <passage_id>` exits 0 (below the rounds-touched cap of 2); else `[ledger]` queue (reason_code `hit-passage-cap` / `batched-nit`).
   - the orchestrator builds the apply-patch stdin from the drafter patch + the LEDGER row: `issue_id` = the ledger id, `passage_id` = the ledger row's passage_id (the drafter only emits `charge_id`/`issue_id` to correlate the patch to its row).
   - else `[det]` `node apply-patch.js apply <tex> <journal>` (exact-once guard; `before-not-found`/`before-ambiguous` -> re-draft or queue).
   - then `[det]` `compile-guard check`: if it no longer compiles -> `[det]` `apply-patch.js revert` + `[ledger]` queue (reason_code `compile-failed`).
   - then `[det]` `anchor-diff` -> `[WF]` `meaning-audit` on the flagged anchors. AUTO: any verdict != `holds` -> revert + queue (reason_code `claim-meaning-change`). REVIEW: advisory, shown to the human.
   - if all guards pass -> `[journal]` already recorded by apply-patch; `[ledger]` status `closed` (round_closed set).
9. `[WF]` **recall-audit**(DROPS, units, skeptics) -> {confirmed_drops, revived}. `[ledger]`: confirmed_drops -> `dropped` (reason in notes; never silent). revived -> `re-trial` (re-enter step 6 once) or `escalate` (status author-required).
10. `[human]`/queue **2nd instance**: author-required + revived-escalations + grounded appeals. REVIEW: present to the author (final ruling, override logged). AUTO: all -> `queued`.
11. `[det]` **report**: `node ledger.js render` + `node ledger.js count`. Stop; do not auto-advance (review). AUTO: loop to the next round until applied-quiescence + `ledger.js gate` PASS.

## Ledger / journal wiring (status transitions)

```
charge filed            -> raised
grand-jury drop         -> DROPS pool (transient) --recall--> dropped | re-trial
trial valid-fixable     -> valid-fixable --drafter+guards--> closed | queued
trial author-required   -> author-required --2nd instance/queue
trial invalid-drop      -> DROPS pool --recall--> dropped | re-trial/escalate
recall revived          -> re-trial (step 6) | author-required
apply ok + guards pass  -> closed (journal_ref set)
guard fail / anchor /   -> queued (reason_code) ; edit reverted via journal
  needs-data
```
The auto `/goal` completion fact is `node ledger.js gate` (0 active blocker/major).
By construction, after applied-quiescence every blocker/major is closed or queued
(both non-active), so the gate flips PASS.

## D5: the model-driven glue is the residual drift surface (named, mitigated)

The deterministic SCRIPTS are trustworthy and the semantic WORKFLOWS are fresh-context
and schema-forced. The RESIDUAL risk surface is the ORCHESTRATION GLUE between them:
the orchestrator (a model) decides which workflow runs next, parses each result, and
issues the ledger/journal writes. A mis-parse or a wrong ledger write is an error no
single script catches. This is named explicitly so it is not mistaken for "fully
deterministic". Mitigations that bound it:
- every applied edit goes through `apply-patch.js` (atomic, exact-once, journaled) ->
  any edit is revertable by `apply-patch.js revert`, so a glue mistake is undoable.
- the completion gate is a DETERMINISTIC ledger fact (`ledger.js gate`), not a model
  judgment -> the loop cannot "decide" it is done.
- the meaning audit gates auto edits; an unresolved drift becomes a `queued` row, so
  the ledger stays non-clean until a human handles it.
- the ledger is re-derivable and human-readable (the MD view) for an end-of-run audit.
Use the no-overclaim discipline at each ledger write: re-read the workflow result
before asserting a status; do not trust in-context recall of a prior step's output.

## Concurrency / batching

`min(16, cores-2) = 16` here. A 12-juror trial fills one wave, so trials SERIALIZE
across charges; `trial.workflow.js` uses `pipeline()` so a charge's defense/judge use
the spare slots while another's jury runs. Keep each workflow invocation under
`MAX_AGENTS_PER_WF ~ 600` (the 1000 lifetime cap is PER invocation): size each phase's
batch from agents-per-item (trials ~14/charge -> ~42 charges/invocation; reading
units x lenses x rounds). One `/goal` round hosts MANY sequential invocations; never
run concurrent top-level workflows.

## Intensity -> workflow args (from AUTO_MODE_DESIGN §9, v2 dials)

| intensity | reading dryStop / lenses | grand-jury screenAgents | trial jurySize | recall skeptics | outer max_rounds |
|---|---|---|---|---|---|
| light | 1 / 3 | 1 | 6 | 1 | 2 |
| standard | 2 / 3 | 2 | 9 | 1 | 3 |
| thorough | 2 / 4 | 3 | 12 | 2 | 4 |

Safety envelope is invariant across intensities (per-passage rounds-touched cap = 2,
anchors never auto-edited, meaning audit every round, bounded-aggressive apply,
grand-jury low bar, recall auditor always runs on every drop).

## Review v2 vs auto

Same engine. REVIEW: step 8 needs per-edit sign-off, the meaning audit is advisory,
step 10 is a live human gate. AUTO: step 8 applies under the bounded-aggressive rule
(blocker/major only, criterion met, audit holds, within rounds-touched cap, not an
anchor), the meaning audit is gating, every human gate becomes a `queued` row, and the
round loop runs under `/goal` until applied-quiescence + gate PASS. See
`AUTO_MODE_DESIGN.md` for the auto policy, queue lifecycle, and termination.
