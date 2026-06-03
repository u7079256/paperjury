# Methodology (the protocol in depth)

This is the venue-agnostic protocol the skill implements. It is the distilled,
generalized core of a multi-round adversarial review-revise loop, with the
external-sync and project-specific machinery stripped out.

## Mental model: each round is a parallel timeline

Reviewers live ONLY in the current round. They have no memory of past rounds.
Each round simulates: "if THIS were the only version of the paper an outside
expert ever saw, what would they say?" This is why the reviewed text is frozen
and stripped of any revision marker, and why reviewers never see the ledger,
each other, or prior rounds. The isolation is what keeps the panel honest:
R2 and R3 must not anchor on R1.

In a Workflow this isolation is free. Each `agent()` only sees its prompt, so
"reviewer may not read X" is enforced by not putting X in the prompt. The
on-disk frozen copy is then only an audit artifact, not a security boundary.

## Modes

- **full**: all reviewers read the whole paper, each produces a per-section
  critique plus an issue table. For a first sweep, a post-major-revision check,
  or a final polish.
- **passage**: all reviewers read ONE unit (a section, subsection, paragraph, or
  a single claim) and produce a unit-scoped issue table. For hardening the
  abstract, the contribution paragraph, one method claim, one figure caption, or
  one experimental finding.

## The ledger (single source of truth)

The ledger lives in the target project and survives across rounds and sessions.
Source of truth is `LEDGER.json` (managed by `scripts/ledger.js`); `LEDGER.md` is a
rendered view. The columns below are that view; the full JSON schema + unified status
state machine (review + v2 courtroom + auto queue) is in `references/ledger-schema.md`.
One row per issue:

```
| id   | round_raised | round_closed | severity | section          | summary        | close_criterion                       | status        |
|------|--------------|--------------|----------|------------------|----------------|---------------------------------------|---------------|
| I-01 | 1            | 3            | major    | intro p3         | novelty vague  | rewrite p3 with one-sentence delta vs [12] | closed   |
| I-02 | 1            |              | blocker  | method eq.(7)    | notation clash | unify d/D usage across method+exp     | agreed-to-fix |
```

Severity: `blocker` > `major` > `minor` > `nit`.

Status state machine:
- `raised` -> just merged from reviewer output, awaiting author response
- `agreed-to-fix` -> consensus by author acceptance, edit pending
- `agreed-to-fix-modified` -> consensus on a refined close_criterion
- `under-discussion` -> author responded, awaiting reviewer verdict
- `withdrawn` -> reviewer conceded after author clarification
- `maintain-pending-tiebreak` -> reviewer held, awaiting author final call
- `override` -> author overrode a maintain (rationale logged)
- `closed` -> edit landed, close_criterion satisfied and verified

The author/orchestrator owns the ledger. Reviewers never touch it.

## close_criterion as a unit-test

Every issue must carry a `close_criterion`: one concrete sentence describing what
an author edit must satisfy to close it. Issues without one are dropped at merge
(note the drop so the author sees it). After an edit lands, re-read the relevant
text and confirm the criterion holds before marking `closed`. For `override`
issues there is no criterion to satisfy; they ship as-is with the override
recorded.

## Round workflow

1. **Configure**: mode, target unit, venue family, personas. Recall conventions
   from memory.
2. **Freeze**: copy the target unit, strip revision/changelog markers. Quick
   check for leak markers (round numbers, "addressed", "fixed in", TODO/FIXME,
   reviewer tags); if found, strip and re-freeze.
3. **Panel (Workflow)**: spawn N reviewers in parallel, each self-contained:
   gatekeeper persona + lens + venue style profile + the frozen text + the
   issue-table schema. Output one schema-validated issue table per reviewer.
4. **Merge (Workflow)**: extract each issue table; dedupe issues raised by >=2
   reviewers into one entry with multi-source `raised_by` (same section anchor
   AND overlapping summary/criterion; when unsure, keep separate); drop
   criterion-less issues; assign IDs; append as `raised`. The orchestrator does
   NOT invent issues at merge; only reviewers raise them. Mark prior-round issues
   `closed` if the current frozen text satisfies their criterion.
5. **Discussion (mandatory gate)**: see below. Every newly-raised issue must
   leave `raised` before any edit.
6. **Report and stop**: round, mode, target, blocker/major/minor counts new vs
   closed, discussion outcomes, next decision point. Do not auto-advance.

## Discussion phase (consensus-gated)

> This documents the legacy single-pass panel discussion (still available via
> `workflows/review-panel.workflow.js` for a quick check). The courtroom per-issue
> adjudication (N holistic domain reviewers -> contestability routing -> two-sided
> 5-tier trial -> three-way verdict -> recall, with a polish track and a clerk-
> converged multi-round loop) is the DEFAULT for review mode: protocol
> `references/review-engine-v3.md` (rationale `docs/REVIEW_ENGINE_V3_DESIGN.md`).

Runs after every merge, before any edit. Goal: every issue that drives an edit is
agreed by both the author and the raising reviewer, or explicitly overridden by
the author with the disagreement documented.

**Step A - Author response (mandatory).** Even to accept everything, produce a
per-issue response. `response_type` in {will-fix, clarification, disagree,
out-of-scope}.
- `will-fix` -> consensus by acceptance, no re-spawn. Status -> `agreed-to-fix`.
- otherwise -> reviewer must re-verdict (Step B).

**Step B - Re-spawn ONLY contested reviewers (Workflow, parallel).** Re-spawn the
original raising reviewer as a fresh agent with: the persona, its OWN initial
report, and the author-response slice for ITS issues only (never the full
response, never peers' material). Discussion-mode framing: weigh the author's
rationale against the original concern, decide per issue concede / refine /
maintain, do NOT open new fronts.
- `concede` -> `withdrawn`
- `refine` -> reviewer tightens the close_criterion both sides accept; update the
  ledger; status `agreed-to-fix-modified`
- `maintain` -> `maintain-pending-tiebreak`, escalate to Step C

**Step C - Author tiebreak (only for maintain).** Present both rationales to the
author:
- yield -> `agreed-to-fix` (or `-modified` if a narrower criterion is negotiated)
- override -> `override`; log issue id/severity/summary/section, the reviewer's
  maintain rationale verbatim, the author's override rationale verbatim, and a
  one-line "if challenged at real review" defense. This log is a pre-submission
  self-audit, not a way to silently dismiss reviewers.

**Step D - Edit gate.** No edit while any current-round issue is in {raised,
under-discussion, maintain-pending-tiebreak}.

The discussion phase is single-pass: no second author rebuttal, no second
reviewer re-verdict. A remaining disagreement ends in override, not another lap.
The issue can be re-examined in a future round once the contested text is
rewritten (the new frozen copy lets reviewers judge independently again).

## Edit policy

- No manuscript edit without explicit author authorization.
- Reviewing, freezing, merging, discussion, and ledger updates are automatic.
- Treat each close_criterion as a unit-test: after editing, re-read and confirm
  before `closed`.
- Track edit reasoning author-side, never in the manuscript.

## Termination

Done when the ledger has zero `blocker` and zero `major` in active statuses (not
closed / withdrawn / override), and all remaining active issues are `minor` or
`nit`. `withdrawn` and `closed` do not count; `override` ships without an edit
and does not block termination but must be re-read at submission. No score gate,
no "N consecutive clean rounds". Recommended sanity check: one more `full` round
on the final draft; if it surfaces a new blocker/major, prior closures were
premature.
