# Ledger schema (the single source of truth)

Decided 2026-06-01 (D1): the ledger is a **JSON file = machine source of truth**, plus
a **rendered Markdown view** for humans. Scripts and the auto `/goal` completion check
read/write the JSON; nobody parses the Markdown. The Markdown is regenerated from the
JSON on every write, never hand-edited.

v3 (review-engine-v3.md) changes the issue SIGNAL: an issue carries `significance`
(major|minor) + `kind` (mechanical|substantive), not the v2 4-tier `severity` (retired,
kept nullable for legacy reads). The completion gate counts GATE-BLOCKING majors;
`author-required` is lifecycle-active but gate-OK (it accumulates in the human queue
across rounds). `close_criterion` is null at intake and required only at `valid-fixable`.

Paths (resolved at runtime, project-owned):
- `<ledger-dir>/LEDGER.json` -- source of truth.
- `<ledger-dir>/LEDGER.md` -- rendered view (overwritten on every save).
- default `<ledger-dir>` = `<manuscript-dir>/.paper-review/`.

The module that owns this schema is `scripts/ledger.js` (Node, dependency-free; a
`require()` module and a Bash-callable CLI, because the deterministic guards run
orchestrator-side between workflow calls).

## One JSON object
```json
{
  "schema": 1,
  "meta": { "manuscript": "<path>", "venue_family": "vision|nlp|ml",
            "created_round": 1, "assignment_unverified": ["R2"] },
  "issues": [ <row>, ... ]
}
```
`meta.assignment_unverified` lists reviewer_ids that assign-reviewers degraded to a
generic gatekeeper for this run (review-engine-v3.md §3.1).

## Row (one per issue = one charge in the courtroom)

A superset serving review v3 + auto (and still readable for legacy v2 rows). A field
is `null`/absent when its phase has not set it.

| field | type | who sets it | meaning |
|---|---|---|---|
| `id` | `"I-01"` | merge intake | global ledger id, zero-padded, assigned at intake |
| `passage_id` | string\|null | orchestrator (from decompose) | cross-round stable id; the clerk merge key + per-passage drift counter key on this |
| `significance` | `major\|minor` | reviewer; merge takes MAX | v3 intrinsic importance (replaces `severity`) |
| `kind` | `mechanical\|substantive` | reviewer; merge: substantive dominates | contestability routing (mechanical/minor -> polish; substantive-major -> trial) |
| `severity` | enum\|null | v2 legacy | retired in v3 (left null); `sigOf()` maps a legacy `blocker\|major`->major, `minor\|nit`->minor |
| `section` | string | reviewer | human-readable anchor (section + eq/table/fig/paragraph) |
| `evidence_anchor` | string\|null | reviewer | exact verbatim quote the charge rests on (quote-verify + trial unit-select key on it) |
| `summary` | string | reviewer | one line, what is wrong |
| `references` | string\|null | reviewer | what would settle it / sections implicated (trial local-context unit-select reads it) |
| `close_criterion` | string\|null | judge (valid-fixable) / polish | null at intake; REQUIRED at `valid-fixable`; one sentence an edit must satisfy |
| `status` | enum | orchestrator | lifecycle, see the state machine below |
| `verdict` | enum\|null | trial | `invalid-drop` \| `valid-fixable` \| `author-required` \| `escalate` (escalate is transient) |
| `reason_code` | enum\|null | auto queue / polish | `anchor-touching` \| `hit-passage-cap` \| `claim-meaning-change` \| `batched-nit` \| `compile-failed` \| `needs-human-input` \| `polish-review` |
| `tally` | {valid,invalid,context_limited}\|null | trial | jury tally (recall Mode B consensus filter reads it) |
| `escalated` | bool | trial | did this charge go to the 12-juror tier (recall Mode B filter: strong consensus = `!escalated`) |
| `reviewer_confidence` | int\|null | merge | MAX `overall_confidence` of the reviewers who raised it (priority tie-break + recall Mode B) |
| `raised_by` | string[] | merge / clerk | reviewer_ids; multi-source (>=2) = corroborated; clerk unions on a re-raise merge |
| `raised_by_count` | int | merge / clerk | corroboration count (priority order + clarity-via-conflict only; NEVER feeds significance) |
| `round_raised` | int | merge | round first raised (the clerk reads `round_raised == current_round` to build thisRound) |
| `round_closed` | int\|null | close | round closed |
| `rounds_touched` | int[] | drafter | distinct rounds an edit touched this passage (auto cap) |
| `drafted_patch` | {before,after}\|null | drafter | a drafted-but-not-applied patch (queue entries carry this) |
| `journal_ref` | string\|null | apply | the `journal.jsonl` entry id when an edit landed (per-edit revert) |
| `notes` | string | any | free text (override rationale, drop reason, "merged into I-xx") |

## Status state machine (v3)

**Lifecycle-ACTIVE** (still demands work; not terminal):
- `raised` -- intake (merged issue), awaiting routing
- `in-trial` -- under the 5-tier (incl. an escalated charge awaiting the 12-tier re-run)
- `re-trial` -- a polish-escalated or recall-revived charge to re-adjudicate (intra-round)
- `valid-fixable` -- trial verdict: fix it, drafter pending (close_criterion required)
- `author-required` -- valid but needs author-private info / new data; ACCUMULATES to 终审
- (review-only) `under-discussion`, `maintain-pending-tiebreak`, `agreed-to-fix`,
  `agreed-to-fix-modified` -- the v2 panel discussion states (not produced by the v3 courtroom)

**GATE-BLOCKING** (the subset of ACTIVE that blocks the round completion gate) =
`{raised, in-trial, re-trial, valid-fixable}`. `author-required` is ACTIVE but gate-OK
(it accumulates in the queue, handled at 终审), so it never blocks a round; the v2
discussion states are excluded (never appear in the v3 courtroom loop, and would
otherwise false-block the gate).

**TERMINAL / non-active** (does not block the gate):
- `closed` -- edit landed, close_criterion verified
- `withdrawn` -- conceded, mooted, or folded by the clerk into another row (re-raise merge)
- `override` -- author shipped as-is over a maintain (rationale logged)
- `dropped` -- judged invalid, dropped WITH a logged reason (recall confirmed). Never silent.
- `queued` -- auto: deferred to the human return queue with a `reason_code`; inert during the run

### The completion gate + queries
- `gatePass(led)` = 0 GATE-BLOCKING active major (`activeCounts().gate_blocking_major === 0`).
  Legacy rows with no `significance` are mapped from `severity` via `sigOf()`.
- `docket(led, round)` = carried open-questions for the clerk = rows in
  `{author-required, queued, valid-fixable}` with `round_raised < round` (`re-trial` is an
  intra-round status, resolved before the clerk, so it is NOT carried).
- `unadjudicated(led)` = active majors with no verdict (`raised`/`in-trial`/`re-trial`,
  verdict null). Must be empty at completion: budget exhaustion / a stalled trial cannot
  fake the gate.

### Mode -> which statuses appear
- **review v3 / courtroom**: raised -> in-trial -> verdict {invalid-drop -> recall -> {dropped |
  re-trial}, valid-fixable -> recall(ModeB) -> drafter+edit-safety -> {closed | queued},
  author-required, escalate -> re-run @12}; polish -> {closed | queued(polish-review) | re-trial |
  dropped}; clerk merge -> withdrawn(merged into).
- **auto**: as the courtroom, but every human gate (author-required, anchor-touching,
  claim-meaning-change, compile-failed, polish-review, needs-human-input) routes to `queued`;
  `closed` only via the bounded-aggressive + edit-safety apply rule.
- **legacy v2 panel** (methodology.md): the discussion-state path; readable here for back-compat.

## Iron rules (enforced by the module + the protocol)
- A row in status `valid-fixable` MUST carry a `close_criterion` (set by the judge);
  intake rows carry `close_criterion: null` (v3 relaxed the v2 always-required rule).
- Never silently drop: a row leaves ACTIVE only into
  `closed`/`withdrawn`/`override`/`dropped`/`queued`, and `dropped` always carries a reason.
- corroboration (`raised_by_count`) is used ONLY for priority order + a clarity-via-conflict
  flag, NEVER to inflate `significance` (no double-count).
- The Markdown view is derived, never authoritative; edit the JSON (via the module), re-render.
- Reviewers/jurors never touch the ledger; the orchestrator owns all writes.
