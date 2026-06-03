---
name: paper-review-loop
description: Three modes for CS-conference papers (CVPR/ICCV/ECCV vision, ACL/EMNLP/NAACL NLP, ICLR/NeurIPS/ICML/AAAI ML). DIRECT-EDIT mode (common): the user describes a change in Chinese or English and the LaTeX is edited directly through a CS-venue writing toolkit with author sign-off (use for 改这段 / 把中文想法写成 latex / polish / de-AI / translate / compress a passage). REVIEW mode (occasional, pre-submission): harden the paper through an adversarial courtroom review engine (N holistic domain reviewers / contestability routing / two-sided trial / three-way verdict / clerk-converged multi-round loop) with consensus-gated, author-signed revisions (use for review / critique / 审稿 / 评审 / mock-review). AUTO mode (unattended, opt-in via /goal): run the review-revise loop toward a verifiable goal, applying safe fixes under a drift-bounded policy and queueing risky ones. Resolves all inputs at runtime, no hardcoded paths. Not a from-scratch drafter (use ml-paper-writing) and not an official-venue rebuttal.
version: 0.5.0
author: Yiran Wang
license: MIT
tags: [Academic Writing, Peer Review, Adversarial Review, CVPR, ICCV, ECCV, ACL, EMNLP, NAACL, ICLR, NeurIPS, ICML, AAAI, Workflow, LaTeX]
---

# Paper Review Loop (CS-conference paper editing and review)

A portable paradigm for editing and hardening any CS-conference paper. It runs in
three modes. In **direct-edit mode** (the common case) the user describes a change
in Chinese or English and the LaTeX is edited directly through a CS-venue writing
toolkit, with author sign-off. In **review mode** (occasional, pre-submission) it
exposes the manuscript to a harsh, multi-perspective courtroom review engine that
adjudicates each issue (N holistic domain reviewers -> contestability routing ->
two-sided trial -> three-way verdict, with a polish track and a clerk-converged
multi-round loop), gates every change behind consensus, and tracks issues in a durable
ledger. In **auto mode** (unattended, opt-in via `/goal`) it runs that same engine
toward a verifiable goal, applying safe fixes under a drift-bounded policy and
queueing the risky ones for one human pass on return. All modes share the same
writing toolkit, hard rules, ledger, and author sign-off (auto via up-front policy
sign-off plus the queue, see hard rule 1).

This skill is **fully generic**. It ships no hardcoded paths, no project files,
and no embedded paper. Everything specific to a given paper (where the
manuscript is, the venue, who signs off, the house style) is resolved at runtime
or supplied by a config the *project* owns. The skill itself is the backbone;
any concrete paper is just an instantiation of it.

Scope: CS conferences only. Three venue families, each with its own style profile:
- **Vision**: CVPR, ICCV, ECCV, WACV
- **NLP**: ACL, EMNLP, NAACL, COLING
- **ML**: ICLR, NeurIPS, ICML, AAAI, COLM

## When to use / when not

Three modes, one skill. Pick by what the user is asking for:
- **Direct-edit mode (the common case).** The user describes a change in Chinese
  (or English) and wants the LaTeX edited directly: "把这段改成...", "polish this
  paragraph", "把我对 intro 的想法写成 LaTeX", "tighten this". No review panel; go
  straight to drafting the patch through the writing toolkit, with author sign-off.
- **Review mode (occasional, pre-submission).** The user wants the paper critiqued
  or hardened: review / critique / 审稿 / 评审 / mock-review, or iterating a draft
  to clear reviewer-raised issues. This runs the courtroom review engine
  (`references/review-engine-v3.md`).
- **Auto mode (unattended).** The user opts in via `/goal` (or config `mode: auto`)
  to run the review-revise loop AFK toward a verifiable goal. Establish the spine
  up front (the one human step), then the engine applies safe fixes under the
  bounded-aggressive policy and queues the rest. See `references/auto-mode.md`.
  Never self-detect auto; it is explicit only.

Do NOT use for: writing a paper from scratch (use `ml-paper-writing`), figure or
diagram generation (use `academic-plotting`), or an official-venue rebuttal (this
is a pre-submission self-hardening loop, no score gate).

## The three primitives

This paradigm is expressed as **Skill + Workflow + Memory**. Each carries one
concern; together they replace the heavy per-round file-and-flag machinery a
hand-rolled version accumulates.

1. **Skill (this folder) = entry point + methodology.** The protocol, the
   reviewer panel, the consensus gate, the writing toolkit, the human gates.
   Detail in `references/methodology.md`, `references/reviewer-personas.md`,
   `references/writing-toolkit.md`.
2. **Workflow = fan-out engine.** The semantic, no-human-in-the-middle steps run as
   Workflows (parallelism + schema-validated output by construction). The simple
   panel is `workflows/review-panel.workflow.js`; the v3 courtroom engine is
   `assign-reviewers` -> `reading-check` -> `coverage-auditor` -> `merge` ->
   {`trial` (+ escalate) || `polish`} -> `recall-audit` -> `drafter` ->
   {`edit-audit` | `meaning-audit`} -> `clerk`. The DETERMINISTIC guards run
   orchestrator-side via Bash between workflow calls (the Workflow sandbox has no fs):
   `scripts/` holds `decompose`, `ledger`, `journal`, `apply-patch`, `anchor-diff`,
   `cross-ref`, `spine`, `compile-guard`, `compliance-check`. Build note: this harness
   delivers a workflow's `args` as a JSON STRING, so every workflow parses it
   defensively. Protocol + every orchestrator seam: `references/review-engine-v3.md`.
3. **Memory = durable state + learned conventions.** Two layers:
   - **Ledger** (`LEDGER.json` resolved at runtime = the machine source of truth,
     plus a rendered `LEDGER.md` view; managed by `scripts/ledger.js`): the live,
     mutable issue state across rounds and sessions. Schema + status state machine:
     `references/ledger-schema.md`.
   - **Claude memory** (the active project's memory): stable conventions worth
     recalling next session, e.g. this paper's house style, venue, persona tuning.

## Resolving inputs at runtime (no hardcoded paths)

The skill ships ZERO hardcoded paths or project files. On trigger it resolves
each input by **discovery first, then asking**:

- **manuscript**: detect the main source (the `.tex` with `\documentclass` /
  `\begin{document}`, or the file the user names). If several candidates, ask.
- **venue_family**: infer from the template / class file or content (e.g. a
  cvpr/iccv style, an acl style, a neurips/iclr style). If unclear, ask.
- **ledger**: default to `<manuscript-dir>/.paper-review/LEDGER.json` (the machine
  source of truth; `scripts/ledger.js` also renders a `LEDGER.md` view). Create if
  absent, reuse if present. The user may point elsewhere.
- **author**: ask who signs off on edits (default: the current user). Every edit
  needs explicit authorization.
- **personas**: default to N domain-expert holistic reviewers assigned at runtime
  (`assign-reviewers`, from the project gatekeeper core + a generated domain overlay);
  the three generic lenses in `references/reviewer-personas.md` are the degrade
  fallback. If the project defines its own named reviewer subagents, use them as
  `agentType`; otherwise inline the persona prompts.
- **style_profile**: start from the venue-family default; refine from any
  conventions recalled from memory or pinned in a project config.

A project MAY pin these by dropping a config in ITS OWN repo (see
`configs/config-template.md` for the shape). That file is owned by the project,
never by this skill. At round start, recall any pinned conventions from memory.

## Direct-edit mode (the common case)

The user states a change in Chinese or English; you draft and apply the LaTeX edit.
No panel, no ledger, no discussion. Minimal flow:

1. **Locate.** Resolve the manuscript and find the target passage the instruction
   refers to (a paragraph, sentence, caption, table cell). If it is ambiguous on a
   large file, ask which passage; do not guess.
2. **Draft.** Pick the writing-toolkit prompt matching the instruction
   (`translate-to-english` for a Chinese idea, `polish-english` / `de-ai` for a
   rewrite, `compress` / `expand` for length, `caption` / `experiment-analysis`
   for those units) and draft the LaTeX patch to do exactly what was asked. The
   Common guards apply (LaTeX-safe, plain CS prose, no log leakage into the .tex).
3. **Self-gate.** Run `logic-check` on the drafted passage.
4. **Sign-off.** Show the patch and get explicit author approval (hard rule 1).
5. **Apply.** Write only the patch into the manuscript; keep any back-translation
   or note author-side.

This is the writing toolkit used on its own. Escalate to review mode only when the
user wants the paper critiqued or hardened, not for a single asked-for edit.

## Why fan-out is a Workflow and the rest is conversation

The panel and the contested-reviewer re-spawn are pure fan-out: spawn, collect,
merge. A Workflow does this deterministically (parallelism enforced by
construction, structured outputs via schema, isolation by default since each
agent sees only the prompt you give it). That isolation is what replaces the
snapshot-and-whitelist defense: a reviewer cannot see peers, the ledger, or prior
rounds because you simply do not put them in its prompt.

But the loop has genuine human gates (the author reviews the issue list, gives
per-issue direction, authorizes edits, breaks ties). Workflows run to completion
and return a result; they do not pause mid-run for hours of human input. So:

- fan-out steps (panel review + merge; contested re-spawn) -> **Workflow**
- human gates (direction, authorization, tiebreak) -> **main conversation turns**
- cross-round truth (the ledger) + stable conventions -> **Memory**

## Review mode: one round, end to end

The full adversarial loop. Use it to harden the paper, not for a single asked-for
edit (that is direct-edit mode). `[WF]` = Workflow step, `[HUMAN]` = author gate,
`[LEDGER]` = state write.

1. **Resolve + recall.** Resolve the inputs above; recall this paper's
   conventions from memory. Pick mode: `full` (whole paper) or `passage` (one
   section / paragraph / claim).
2. **Freeze the unit.** Copy the target text, strip any revision/changelog
   markers so reviewers meet it fresh. Keep one frozen copy per round for audit.
3. **`[WF]` Review panel.** Spawn N reviewers in parallel (default 3), each with
   the gatekeeper persona, its lens, the venue style profile, and ONLY the frozen
   text. Each returns a schema-validated issue table (every issue carries a
   `close_criterion`).
4. **`[WF]` Merge.** Mechanically dedupe issues raised by >=2 reviewers, drop any
   issue missing a `close_criterion`, assign IDs. `[LEDGER]` append as `raised`.
5. **`[HUMAN]` Direction.** Author gives a per-issue verdict: will-fix /
   clarification / disagree / out-of-scope.
6. **`[WF]` Discussion** (only if any issue is contested). Re-spawn the original
   raising reviewer in discussion mode with its own report plus the author
   response for its issues only. Returns concede / refine / maintain.
   `[LEDGER]` update.
7. **`[HUMAN]` Tiebreak.** For each `maintain`, the author yields or overrides
   (override is logged with both rationales for a pre-submission self-audit).
8. **Edit gate.** No manuscript edit until every current-round issue is in
   agreed-to-fix / agreed-to-fix-modified / withdrawn / override.
9. **`[HUMAN]` Authorize + draft.** On authorization, draft each patch through the
   writing toolkit so it satisfies that issue's `close_criterion`. Verify the
   criterion, then `[LEDGER]` mark `closed`. Revision logs / back-translations
   stay author-side, never in the manuscript.
10. **Report + stop.** Summarize new/closed counts and the next decision point.
    Do not auto-start the next round.

Full protocol, ledger schema, status state machine: `references/methodology.md`.

## Hard rules (load-bearing, venue-agnostic)

1. **Never edit the manuscript without explicit author sign-off.** Auto-mode
   carve-out: the rule HOLDS; auto satisfies it via UP-FRONT sign-off (the spine
   confirmation + the pre-authorized bounded-aggressive policy) plus the return
   queue, not per-edit sign-off. Nothing outside the authorized envelope is applied.
2. **Reviewers / jurors are isolated.** Fresh eyes per round: no cross-talk, no
   prior-round leakage, no sight of the ledger. Enforced by (a) what goes into each
   agent's prompt AND (b) an explicit ISOLATION instruction in every reviewer-type
   prompt telling the agent to judge only the quoted text and not read files
   (workflow agents have read tools and will otherwise sometimes roam).
3. **Every issue carries a `close_criterion`** (one concrete sentence describing
   what an edit must satisfy). Issues without one are dropped at merge.
4. **No leakage into the reviewed text.** Revision logs, back-translations, and
   self-check verdicts are author-side aids; they never enter the manuscript or
   any frozen snapshot.
5. **Disagreement resolves through discussion, then override** (logged), never a
   silent dismissal.
6. **No hardcoded paths or project files in the skill.** Resolve at runtime.

## Memory convention

- At round start: recall the paper's conventions (house style, venue, persona
  tuning) from memory; read the resolved `LEDGER.json` for open issues.
- During the round: the ledger is the only mutable truth; update it at merge,
  discussion, tiebreak, and close.
- After the round: persist any newly learned stable convention to memory (e.g. a
  house-style rule a reviewer surfaced), not the transient issue state.

## Maximizing it under ultracode

The fan-out engine implements the strong form directly
(`workflows/review-panel.workflow.js`):

- **loop-until-dry**: re-runs independent fresh panels and accumulates only issues
  not seen before, stopping after `dryStop` consecutive passes that add no
  surviving issue (hard cap `maxRounds`). Raises recall past a single pass.
- **adversarial verify**: each new issue faces perspective-diverse skeptics
  (misreading / already-addressed / scope-or-severity) and is kept unless a
  majority refute it, filtering plausible-but-wrong issues before they reach the
  ledger. Bias is to keep, so real flaws are not lost.

Toggle via args: ultracode on -> defaults (`maxRounds` 4, `dryStop` 2,
`verify` true); ultracode off -> pass `{maxRounds:1, verify:false}` for the basic
single-panel form. The loop is budget-aware and stops early if the token budget
runs low.

Further headroom not yet wired: a completeness-critic pass ("what did the panel
miss?") and scaling reviewer count or running independent panels per pass.

## Built engine + guards (operational)

The systems below are BUILT. The v3 engine was hardened by two adversarial workflows
(a design validation, then a built-code cross-check with fresh-skeptic verification of
each finding); the confirmed defects were fixed and the orchestrator seam contracts
written into `references/review-engine-v3.md`. The ledger is unit-tested. NOT yet
validated: the v3 core end-to-end on a REAL paper (three-way routing accuracy, the
5-tier trial, the drafter/apply/edit-safety chain on real edits, the clerk convergence,
the `/goal` auto loop). That real-paper run is the remaining milestone.

- **Review-engine v3** (the courtroom engine; the default for review mode): protocol
  `references/review-engine-v3.md`; workflows `assign-reviewers` -> `reading-check` ->
  `coverage-auditor` -> `merge` -> {`trial` || `polish`} -> `recall-audit` -> `drafter`
  -> {`edit-audit` | `meaning-audit`} -> `clerk`; deterministic guards in `scripts/`
  (incl. `cross-ref`). Routing is by CONTESTABILITY (mechanical/minor -> polish track;
  substantive-major -> the 5-tier). Design rationale: `docs/REVIEW_ENGINE_V3_DESIGN.md`
  (v3 supersedes the v2 prosecution; `docs/REVIEW_ENGINE_V2_DESIGN.md` is retained as
  history).
- **Auto mode** (3rd mode, unattended via `/goal`): the v3 engine + the spine + the
  edit-safety guard + the deterministic safety-envelope helpers + the clerk-converged
  outer loop. The unattended loop is the documented `references/auto-mode.md` procedure,
  NOT yet run end-to-end. Design: `docs/AUTO_MODE_DESIGN.md`.
- **Submission-readiness** (cross-mode): `references/submission-compliance.md` +
  `scripts/compliance-check.js` (A, desk-reject shield) and the compile-driven layout
  loop reusing `scripts/compile-guard.js` (B). Design: `docs/SUBMISSION_READINESS_DESIGN.md`.

The simple `review-panel.workflow.js` remains available for a quick single-pass panel.
Build note: this harness delivers a workflow's `args` as a JSON string (every workflow
parses it), and workflow agents have file-read tools (the ISOLATION instruction keeps
reviewers on their quoted text). All engine agents run on Opus 4.8.

## Related skills

- `ml-paper-writing`: from-scratch drafting, citation verification (never
  hallucinate citations), conference checklists. This loop borrows its
  sentence-level guidance for the edit-drafting step rather than duplicating it.
- `academic-plotting`: figure and architecture-diagram generation (out of scope
  here; this loop edits text and captions, not figure images).
