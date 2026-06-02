# Ledger schema (the single source of truth)

Decided 2026-06-01 (D1): the ledger is a **JSON file = machine source of truth**,
plus a **rendered Markdown view** for humans. Scripts and the auto `/goal`
completion check read/write the JSON; nobody parses the Markdown. The Markdown is
regenerated from the JSON on every write, never hand-edited.

Paths (resolved at runtime, project-owned):
- `<ledger-dir>/LEDGER.json` — source of truth.
- `<ledger-dir>/LEDGER.md` — rendered view (overwritten on every save).
- default `<ledger-dir>` = `<manuscript-dir>/.paper-review/`.

The module that owns this schema is `scripts/ledger.js` (Node, dependency-free;
usable as a `require()` module and as a Bash-callable CLI, because the
deterministic guards run orchestrator-side between workflow calls).

## One JSON object

```json
{
  "schema": 1,
  "meta": { "manuscript": "<path>", "venue_family": "vision|nlp|ml", "created_round": 1 },
  "issues": [ <row>, ... ]
}
```

## Row (one per issue = one charge in v2)

Superset serving all three engines. A field is `null`/absent when its engine is
not in play (plain review never sets `verdict`; non-auto never sets `reason_code`).

| field | type | who sets it | meaning |
|---|---|---|---|
| `id` | `"I-01"` | merge / charge intake | global ledger id, zero-padded, assigned at intake |
| `passage_id` | string\|null | decompose | cross-round stable id `section-path#ordinal#anchor-hash`; the per-passage drift counter and oscillation guard key on this |
| `severity` | enum | reviewer | `blocker` > `major` > `minor` > `nit` |
| `section` | string | reviewer | human-readable anchor (section + eq/table/fig/paragraph) |
| `evidence_anchor` | string\|null | reviewer (v2 charge) | exact quote / location the charge rests on |
| `summary` | string | reviewer | one line, what is wrong |
| `close_criterion` | string | reviewer | one concrete sentence an edit must satisfy (rows without one are dropped at merge) |
| `status` | enum | orchestrator | lifecycle, see state machine below |
| `verdict` | enum\|null | v2 trial | `invalid-drop` \| `valid-fixable` \| `author-required` \| `split` |
| `reason_code` | enum\|null | auto queue | `anchor-touching` \| `hit-passage-cap` \| `claim-meaning-change` \| `batched-nit` \| `compile-failed` \| `needs-human-input` |
| `raised_by` | string[] | merge | source reviewer/lens ids (multi-source when >=2 raised it) |
| `round_raised` | int | merge | round first raised |
| `round_closed` | int\|null | close | round closed |
| `rounds_touched` | int[] | drafter | distinct rounds an edit touched this issue's passage (auto cap = 2) |
| `drafted_patch` | {before,after}\|null | drafter | a drafted-but-not-applied patch (queue entries carry this) |
| `journal_ref` | string\|null | apply | id of the `journal.jsonl` entry when an edit landed (per-edit revert) |
| `notes` | string | any | free text, e.g. override rationale pointer |

## Status state machine (unified)

**ACTIVE** (demands work; counts toward the auto `/goal` completion gate
"0 blocker and 0 major active"):

- `raised` — intake (merged reviewer issue / filed charge), awaiting handling
- `in-trial` — v2 transient, under trial
- `under-discussion` — review, author responded, awaiting reviewer re-verdict
- `maintain-pending-tiebreak` — review, reviewer held, awaiting author final call
- `agreed-to-fix` — review consensus by acceptance, edit pending
- `agreed-to-fix-modified` — review consensus on a refined close_criterion
- `valid-fixable` — v2 verdict: fix it, drafter pending
- `author-required` — v2 verdict: needs author-private info / a judgment call, pre-escalation

**TERMINAL / non-active** (does not block the completion gate):

- `closed` — edit landed, close_criterion verified by re-read
- `withdrawn` — reviewer conceded after clarification, or issue mooted
- `override` — author shipped as-is over a maintain (rationale logged)
- `dropped` — judged invalid, dropped WITH a logged reason (recall audit confirmed, or auto reconciliation mooted). Never a silent drop.
- `queued` — auto: deferred to the human return queue with a `reason_code`; INERT during the run (never auto-applies, never trips guards). This is what lets applied-quiescence terminate while real-but-unsafe work waits for the human.

### Mode -> which statuses appear
- **review** (current panel + methodology.md): raised -> {agreed-to-fix, agreed-to-fix-modified, under-discussion -> {withdrawn, maintain-pending-tiebreak -> {agreed-to-fix, override}}} -> closed.
- **v2 courtroom**: raised -> in-trial -> verdict {invalid-drop -> recall audit -> {dropped | back to in-trial}, valid-fixable -> drafter -> closed, author-required|split -> queued/2nd-instance}.
- **auto**: as v2, but every human gate (author-required, grounded appeal, recall escalation, anchor-touching, hit-passage-cap, claim-meaning-change, compile-failed, needs-human-input) routes to `queued` with the matching `reason_code`. `closed` only via the bounded-aggressive apply rule.

## Iron rules (enforced by the module + the protocol)
- Every row keeps a `close_criterion` or it never enters the ledger (dropped at merge with a logged reason).
- Never silently drop: a row leaves `active` only into `closed`/`withdrawn`/`override`/`dropped`/`queued`, and `dropped` always carries a reason in `notes`.
- The Markdown view is derived, never authoritative; edit the JSON (via the module), then re-render.
- Reviewers/jurors never touch the ledger; the orchestrator owns all writes.
