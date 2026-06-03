# Review engine v2 — design rationale (SUPERSEDED by v3)

> SUPERSEDED. The shipped engine is now v3 (`docs/REVIEW_ENGINE_V3_DESIGN.md`,
> operational `references/review-engine-v3.md`). v3 replaces v2's per-(unit x lens)
> prosecution + grand-jury screen with N holistic domain reviewers, contestability
> routing, a polish track, a risk-proportional edit-safety guard, and a clerk-converged
> multi-round loop. This file is retained as history for the v2 rationale.

Status: design v0 + BUILT 2026-06-01. This doc is the RATIONALE; the operational
protocol of the built engine is `references/review-engine-v2.md`, the workflows are
`workflows/{reading-check,grand-jury,trial,drafter,recall-audit}.workflow.js`, and the
deterministic guards are in `scripts/`. v2 reframes review (vs the legacy single-pass
`review-panel.workflow.js`) as a COURTROOM-style, per-issue adjudication engine.

## 0. Why v2 (the fixed agent-team era's failure modes)

The original design is from the "agent team" era: a fixed panel, a single pass, and
a discussion phase where the RAISING reviewer defends its own issue. Observed /
named failure modes it does not solve:

- agents focus on trivial things (death-by-nits)
- agents anchor to their own prior opinion and will not concede (entrenchment)
- agents drift the article content
- hallucination
- overclaim (assert a status without re-deriving it)
- not reading carefully (attention diluted over a long doc)

v2's goal: drastically cut the human-in-the-loop load (e.g. an old run might queue
~100 points; v2 should leave a small, high-signal set, often <=10) WITHOUT silently
dropping real issues.

## 1. Core principle: accuracy dissolves the precision/recall tradeoff

The precision/recall tradeoff is NOT fundamental; it is the symptom of a NOISY
validity judgment thresholded into keep/drop. The root lever is the ACCURACY of the
per-issue validity assessment. With accurate assessment + a THREE-WAY epistemic
routing (not a binary threshold), precision and recall rise together:

```
invalid-drop     accurately judged invalid (hallucination/misreading/redundant/
                 out-of-scope/severity-inflated) -> drop, with evidence
valid-fixable    accurately judged valid + decidable from text + safe -> fix
author-required  accurately judged to need author-private info or a judgment call
                 -> route to the human (this is correct handling, not a recall loss)
```

The queue size formula makes the goal precise:

```
queue = irreducible (genuinely author-only decisions) + (could-not-confidently-classify)
```

The first term is irreducible; the second SHRINKS as assessment accuracy rises. So
investing compute in accuracy pushes the queue toward its irreducible floor without
dropping any real issue. Corollary on where to spend "maximal" compute: on the
ACCURACY layers (verification / grounding / adjudication), NOT on generating more
issues (more generators alone makes the 100-problem worse).

Honest residual: soft dimensions (net-effect, severity, decidability) keep a
residual error. Rule: when uncertain, ROUTE to the human, never silently drop or
silently fix. This preserves recall; the cost is a slightly larger queue, only for
the genuinely uncertain, and it shrinks as accuracy improves. v2 does NOT promise
perfect grasp / zero queue.

## 2. The courtroom metaphor, made precise

- **charge = the issue** (the alleged flaw). NOT the defendant.
- **defendant = the specific passage / claim the issue attacks.**
- **verdict = is the paper guilty of this alleged flaw** (= is the issue valid).
- One trial PER charge (per issue); the paper is never tried as a whole.
- This labeling keeps **reviewer = prosecution** and **author agent = defense**
  consistent. (If the issue were the "defendant", the prosecution/defense roles
  would invert and muddy.)

Two jury concepts, each in its right role:
- **Grand jury = the cheap Tier-1 screen** (one-sided, low bar, bias-to-indict).
  Drops only the obviously invalid; passes anything non-obvious to trial. The low
  bar protects recall. Keep it CHEAP (deterministic checks + 1-3 light agents); a
  16-23 deliberative body here is cost without function.
- **Trial jury = the Tier-2 verdict body** (two-sided, hears both prosecution and
  defense, rules on evidence). Sized at 12 (the US trial-jury number), but worth 12
  ONLY if the jurors are DECORRELATED (distinct lenses / framings); 12 identical
  jurors ~= 5. Majority vote.

Two instances:
- **First instance (agents)**: judge + jury render the verdict.
- **Second instance (the human)**: hears only the escalations.

## 3. Roster (division of labor)

| Role | Who | Job |
|---|---|---|
| Prosecution | reviewer corps (per-unit close-read + loop-until-dry) | file the charge: issue + severity + close_criterion + evidence anchor (exact location); then REST/exit (no defending its own issue) |
| Defense | author agent | steelman the paper against this charge WITH EVIDENCE (addressed at X / out-of-scope per norm Y / fixing it would drift anchor A4); bare "it's fine" does not count (same evidence standard as prosecution -> protects recall) |
| Grand jury (Tier-1 screen) | deterministic checks + 1-3 light agents | low-bar probable-cause screen; drop the obviously invalid, pass the rest |
| Trial jury (1st instance, fact-finder) | 12 diverse fresh-context jurors, majority vote | rule on validity from BOTH sides' evidence; output verdict + reasons |
| Judge (1st instance, presiding) | 1 presiding agent | convene the trial; tally the majority verdict + dissent; ENTER judgment per the routing rules (drop / fix / refer); for valid-fixable set the "sentence" (the precise close_criterion) and commission the drafter; a split / uncertain jury -> refer |
| Drafter (sentence execution) | author agent (different hat) | for valid-fixable only, draft the minimal-edit fix meeting the close_criterion, under drift / journal / compile guards |
| Recall auditor (prosecution-side appeal) | fresh skeptic, NOT the original reviewer | re-examine EVERY drop ("did the defense's evidence really hold?"); catch wrongly-dropped real issues -> re-trial or escalate. Fixes the recall hole left by "only the defense can appeal" |
| Appeal (defense-side) | author agent | review each verdict; accept the agreed ones (settled); appeal only ON GROUNDS (the fix alters intent/claim, the verdict rests on a factual error, new evidence) -> 2nd instance |
| Second instance / final | the HUMAN (author) | sees ONLY: referrals + grounded appeals + recall-auditor escalations; final decision, logged (override-audit). This is the small ~10 queue |
| Clerk / bailiff (out of court) | orchestrator + deterministic scripts | run anchor-diff / compile / submission-compliance / severity guards (feed evidence + gate the drafter); maintain the ledger (court record); write the per-edit journal (revertable docket) |

### 3.1 No cross-wiring (locked labels)

Locked to prevent role confusion at build time:
- **issue = the CHARGE, never the defendant.** The defendant is the passage / claim
  the issue attacks. ONE CASE per issue. (If the issue were the defendant,
  prosecution and defense would invert, e.g. the reviewer would become the defense.)
- **"author" is TWO different actors.** The author AGENT = the defense (an agent,
  inside the trial). The HUMAN author = the 2nd instance (the appellate judge, e.g.
  the senior author). Never conflate them.
- **The author agent wears two hats at different stages:** defense (during the
  trial) and drafter (after a valid-fixable verdict). Same persona, different job,
  different stage.
- **The recall auditor is NOT the original reviewer.** It is a fresh skeptic
  (prosecution-side appeal), kept fresh to avoid re-entrenchment.
- **The reviewer (prosecution) rests after charging.** It does not judge or defend
  its own issue (that was the old discussion phase's mistake).
- **The jury votes; the judge enters judgment.** The judge does not vote; the jury
  does not set the sentence.

## 4. Flow of one issue

```
1 charge    reviewer files the charge (issue + close_criterion + evidence anchor) -> exits
2 screen    grand jury (Tier-1): obviously invalid -> drop; else -> trial
3 convene   judge gives the charge + the defense's evidence to the jury
4 deliberate 12 diverse jurors each vote on validity from the evidence
5 judgment  judge applies the majority verdict:
              invalid-drop  -> sent to recall audit
              valid-fixable -> judge sets close_criterion -> drafter edits (under guards) -> settled (journaled)
              referral / split -> escalate to 2nd instance
6 recall    recall auditor re-checks every drop; catch a wrongful drop -> re-trial / escalate
7 appeal    defense appeals the verdicts it contests ON GROUNDS -> escalate
8 2nd inst. the human sees only referrals + appeals + recall escalations -> final ruling, logged
```

Where precision/recall is protected at each step: low-bar screen (recall);
two-sided evidence-only trial (accuracy); 12 diverse majority vote (verdict
accuracy); recall auditor (covers wrongful drops); referral (does not force-decide
author-only matters); grounded appeal (keeps the human queue minimal).

## 5. Failure-mode -> mechanism

| Failure mode | Mechanism |
|---|---|
| death-by-nits | severity-calibration stage + tiering + batch; nits never dominate the queue |
| entrenchment | the raising reviewer rests after charging; a fresh, disinterested jury rules; nobody judges their own claim |
| drift | frozen spine + four-state meaning audit + per-passage rounds-touched cap + minimal-edit drafter (engine property; see AUTO_MODE_DESIGN) |
| hallucination | every charge anchored to an exact location + schema-forced evidence quote + the grand-jury premise check ("is the claim actually true in the text?") |
| overclaim | re-read the source before any status verdict + provenance tags + evidence-forcing schema + fresh-context jury (the rule recorded in the no-overclaim memory) |
| not reading carefully | decompose -> per-unit close-read fan-out (one agent, one unit, read every sentence); parallelism makes deep reading cheap |

## 6. Mechanism split (same discipline as auto)

- **Deterministic, orchestrator-side scripts** (Workflow sandbox has no fs /
  subprocess): anchor-diff, compile / structure guard, submission-compliance,
  severity-floor filter, the grand-jury checkable checks (premise / redundancy /
  criterion-present). They feed evidence INTO the trials and gate the drafter.
- **Semantic, workflow agents**: prosecution, defense, jury, judge, recall auditor.
- **Human gates**: the 2nd instance (referrals + appeals + recall escalations).

## 7. Concurrency (grounded on this machine: 20 physical / 28 logical cores)

`min(16, cores-2)` binds at the 16 ceiling here, so the concurrency cap is 16
simultaneous agents per workflow (a simultaneity cap, not a total; lifetime cap is
1000 agents per workflow).

- A 12-juror trial fills one wave (12 < 16), so a trial's jury runs at once; two
  12-juror trials need 24 > 16, so **trials serialize across issues** (~one trial
  per wave). This is the deliberate depth-over-breadth choice.
- The cheap screen / defense / recall audit trickle into the ~4 spare slots; use
  `pipeline()` (not `parallel()`) to keep the pipe saturated without barriers.
- ~80 twelve-juror trials per workflow invocation before the 1000 lifetime cap; a
  paper that yields more issues than that after screening is batched across
  invocations.
- "Maximize utilization" here means many issues processed (breadth) given the
  serialization, plus a diverse-12 jury for verdict depth. Parallelism makes it
  FASTER and wider; it does NOT itself make verdicts more accurate (that comes from
  the two-sided, evidence-only structure).

## 8. Relationships

- **Replaces** the discussion-phase variant in `review-panel.workflow.js`
  (concede/refine/maintain by the raising reviewer) with the
  charge -> screen -> two-sided trial -> judgment -> appeal structure.
- **Shares** auto mode's guards and artifacts: the frozen spine, the four-state
  meaning audit, the ledger, the per-edit journal (see AUTO_MODE_DESIGN). The engine
  is the same in review and auto; auto just removes the human and routes every human
  gate to the queue / policy.
- **Submission-readiness** (SUBMISSION_READINESS_DESIGN) A's compliance checker is
  one of the clerk's deterministic guards.

## 9. Honest caveats

- Diminishing returns: jury accuracy saturates; 12 helps only if decorrelated.
- The verifiers / jurors can themselves err; multi-angle and the evidence standard
  mitigate but do not zero this.
- Soft-dimension residual is ROUTED (to the human), not resolved. Not zero-queue,
  not "perfect grasp".
- Defense over-reach (steelmanning a real issue away) is bounded by the evidence
  standard: a drop requires concrete evidence, same bar as the charge.

## Changelog
- 2026-06-01 v0: review-engine v2 recorded from discussion. Core = accurate
  per-issue validity assessment + three-way epistemic routing dissolving the
  precision/recall tradeoff. Courtroom architecture: charge=issue,
  defendant=passage; reviewer=prosecution, author agent=defense; grand-jury cheap
  screen + 12 diverse trial jury + presiding judge; two instances (agents 1st,
  human 2nd); recall auditor for appeal symmetry; grounded appeals; failure-mode
  mapping; deterministic/semantic/human split; concurrency grounded at 16 on this
  machine (12-juror trials serialize, ~80/invocation).
