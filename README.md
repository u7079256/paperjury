**English** · [中文](README.zh-CN.md)

# paper-review-loop

> A portable approach to editing and hardening any CS-conference paper, in three modes.

<p align="center">
  <a href="https://u7079256.github.io/papercourt/overview.html?lang=en"><img alt="Open the live interactive overview" src="https://img.shields.io/badge/Open_the_interactive_overview-d6a14b?style=for-the-badge&logo=githubpages&logoColor=white"></a>
</p>

A Claude Code skill that edits and hardens CS-conference papers. It is one skill exposing three modes (direct-edit, review, auto), backed by a courtroom-style review engine and deterministic guards.

Interactive overview: the [live site](https://u7079256.github.io/papercourt/overview.html?lang=en) (GitHub Pages), or [`docs/overview.html`](docs/overview.html) in-repo.

---

## Install

It is a Claude Code skill (no plugin-marketplace entry yet). Install it by cloning the repo into the folder Claude Code reads skills from:

```bash
git clone https://github.com/u7079256/papercourt ~/.claude/skills/paper-review-loop
```

(or under `<project>/.claude/skills/` to scope it to one project). Claude Code auto-discovers it through `SKILL.md` and it shows up as the `paper-review-loop` skill. `node` is required (the deterministic checks run on it); a LaTeX toolchain is optional (only the layout/compile check uses it).

**For Claude / coding agents:** the deep "how to drive this" reference is [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md): install, the three modes and their triggers, the engine pipeline, the `auto` vs `/goal` distinction, and how the fan-out launches, written for an agent to read. Curious about the internals? Just point Claude at that file and ask.

---

## What and why

**What:** one skill, three modes (direct-edit, review, auto), backed by a courtroom-style review engine and deterministic guards.

**Why this design:**

- One approach spanning quick LaTeX edits through adversarial multi-agent review, instead of separate tools.
- Adversarial by design: rigorous, precise, constructive domain reviewers that separate critical flaws from minor fixes.
- Routing by CONTESTABILITY, not severity: deep deliberation is spent only where a charge is genuinely contested; mechanical and minor issues take a cheap polish track.
- Human gates and author sign-off are built in, not added as an afterthought.
- Durable cross-round, cross-session state via a machine-readable `ledger`, with a multi-round loop the clerk drives to convergence.

## Scope

**CS conferences only.** Three venue families, each with its own style profile:

- **Vision:** CVPR, ICCV, ECCV, WACV
- **NLP:** ACL, EMNLP, NAACL, COLING
- **ML:** ICLR, NeurIPS, ICML, AAAI, COLM
---

## Three modes

### Direct-Edit (common)

- **Trigger:** describe a change in Chinese or English and have the LaTeX edited directly.
- **Example utterances:** "把这段改成…", "polish this paragraph", "把我对 intro 的想法写成 LaTeX", "tighten this".
- **Behavior:** no review panel; go straight to drafting the patch through the writing toolkit, with author sign-off.

### Review (occasional)

- **Trigger:** ask for the paper to be critiqued or hardened: review / critique / 审稿 / 评审 / mock-review, or iterating a draft to clear reviewer-raised issues.
- **Behavior:** runs the courtroom review engine (`references/review-engine-v3.md`).
- **Scope sub-trigger:** `full` (whole paper) or `passage` (one section / paragraph / claim).

### Auto (unattended)

- **Trigger (explicit only):** opt in via `/goal` (or config `mode: auto`) to run the review-revise loop unattended toward a verifiable goal.
- **Hard constraint:** **auto is never self-detected; it is explicit only.** There is no runtime signal for it, so it is entered only via a `/goal` context or a project config `mode: auto`.
- **Behavior:** establish the `spine` and the reviewer assignment up front (the human steps), then the engine applies safe fixes under the bounded-aggressive + edit-safety policy, queues the rest, and runs multiple rounds until it stops: on clerk convergence, or an applied-quiescence / hard-limit backstop. See `references/auto-mode.md`.

---

## Usage examples: what to do when

You don't run commands; you say what you want and the skill picks the mode.

**Edit one thing (the everyday case → direct-edit):**
- "Polish this paragraph." / "把这段 intro 改紧一些。"
- "Turn my Chinese note for the intro into LaTeX: `<your idea>`."
- "De-AI this paragraph." / "Compress this sentence to one line." / "Rewrite this caption."
- → it drafts the LaTeX change, self-checks it, shows you the patch, and applies it after you approve. No panel.

**Get the paper critiqued before submission (→ review):**
- "Review my paper." / "审稿。" / "Mock-review this before I submit."
- "Critique just Section 3.2." / "review passage `<the claim you paste>`."
- "Here are the issues a reviewer raised; iterate the draft to clear them."
- → it runs the adversarial engine, surfaces the real weaknesses (separating fatal flaws from nits), and walks you through each: you give direction, it drafts fixes you authorize. Nothing changes without your sign-off.

**Harden it unattended toward a goal (→ auto, needs `/goal`):**
- `/goal "harden the paper until ledger.js gate passes (0 gate-blocking major)"`
- → it runs the review-revise loop across many rounds on its own, applying safe fixes and queueing risky ones for one pass when you return. This needs the `/goal` driver: turning on "auto" tool-permission and sending a normal prompt runs one round and stops, it does not loop (see [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) §3).

**Make sure it won't get desk-rejected:**
- "Run the submission-readiness / compliance check." → deterministic format screening + a compile-driven layout check.

Rule of thumb: **one change → just say it; want it picked apart → say "review"; want it run unattended → `/goal`.**

---

## Engine overview

The courtroom engine is `assign-reviewers → reading-check → coverage-auditor → merge → {trial ‖ polish} → recall-audit → drafter → {edit-audit | meaning-audit} → clerk`. Generation is bounded (N holistic domain reviewers, not a per-(unit × lens) flood); adjudication is routed by contestability; edits are guarded by risk; the multi-round loop converges via a deterministic clerk. The **deterministic guards in `scripts/`** run orchestrator-side via Bash between workflow calls.

### Deterministic stages (orchestrator-side, Node via Bash)

1. `decompose`: split manuscript into reading units, the canonical section list, and stable `passage-id`s (which prevent text drift and give jurors local context).
2. `spine` (auto only): extract anchors, author confirm, freeze → `spine.json`.
3. `ledger.js`: JSON ledger plus MD view; **gate = `/goal` completion fact** (0 gate-blocking active major; author-required is gate-OK and accumulates to the human queue). CLI: init/add/set/count/gate/get/docket/unadjudicated/render.
4. `journal.js`: append-only per-edit revert log (JSONL).
5. `apply-patch.js`: atomic apply plus journal of a drafted patch, and revert (exact-once guard on `before` text).
6. `anchor-diff.js`: locate frozen anchors; flag which `need_audit` when the support region changed.
7. `cross-ref.js`: edit-safety risk pre-filter: does a changed salient token in a patch appear in other passages?
8. `compile-guard.js`: real LaTeX compile (latexmk/pdflatex) or a degraded structural-lint path with `compiled:null` (it reports when it cannot verify).
9. `compliance-check.js`: submission-readiness A: deterministic desk-reject screening.

### Semantic stages (workflow fan-out)

1. `assign-reviewers`: name N subfields, instantiate N domain reviewers from the project gatekeeper core + a generated domain overlay; config-pin / verifier / per-slot degrade headless.
2. `reading-check`: N holistic reviewers each read the WHOLE paper once → weaknesses (significance + kind + verbatim quote; a reviewer that cannot quote the source did not read it) + one overall_confidence + a per-section coverage report; targeted re-invoke mode for anti-skim.
3. `coverage-auditor`: anti-skim L2: flag skimmed (reviewer, section) pairs across the coverage reports.
4. `merge`: semantic dedup across reviewers; the workflow derives significance (MAX) / kind (substantive-dominates) / corroboration deterministically.
5. `trial`: a 5-juror trial tier: whole-paper defense → independent local-context jury (with on-demand context expansion) → a deterministic majority verdict (quorum reached, one side >60%) + a judge that routes a decided-valid charge (valid-fixable vs author-required); escalate to a 12-juror tier on no clear majority.
6. `polish`: the track that skips the jury: batch copy-edit (mechanical) + batch light-check (minor-substantive); can escalate a misrouted major back to trial.
7. `recall-audit`: Mode A revives wrongly-dropped charges (bias to revive); Mode B spot-checks strong-consensus majors before the edit (guards against the whole panel agreeing on the same mistake).
8. `drafter`: minimal-edit patch for valid-fixable charges.
9. `edit-audit` / `meaning-audit`: the edit-safety semantic half: `edit-audit` checks a risky non-anchor edit (make-sense + cross-section alignment); `meaning-audit` is the four-state frozen-anchor + arc audit.
10. `clerk`: the round boundary: reconcile carried open-questions against this round's edits, dedup re-raises via a deterministic passage_id + similarity merge key, and emit the deterministic convergence counts.

Also present: `review-panel.workflow.js`: a quick simple 3-lens panel (fast path).

---

## The three primitives: Skill + Workflow + Memory

1. **Skill (entry point + methodology):** the protocol, the reviewer assignment, the consensus gate, the writing toolkit, the human gates. Detail in `references/review-engine-v3.md`, `references/reviewer-personas.md`, `references/writing-toolkit.md`.

2. **Workflow (fan-out engine):** the semantic, no-human-in-the-middle steps run as Workflows (parallelism plus schema-validated output by construction). Simple panel = `workflows/review-panel.workflow.js`; the courtroom engine = `assign-reviewers → reading-check → coverage-auditor → merge → {trial ‖ polish} → recall-audit → drafter → {edit-audit | meaning-audit} → clerk`. The deterministic guards run orchestrator-side via Bash because the Workflow sandbox has no fs: `scripts/` holds `decompose`, `ledger`, `journal`, `apply-patch`, `anchor-diff`, `cross-ref`, `spine`, `compile-guard`, `compliance-check`.

3. **Memory (durable state + learned conventions), two layers:**
   - **Ledger**: `LEDGER.json` resolved at runtime = the machine source of truth, plus a rendered `LEDGER.md` view; managed by `scripts/ledger.js`. The live, mutable issue state across rounds and sessions. Schema plus status state machine: `references/ledger-schema.md`.
   - **Claude memory**: the active project's memory: stable conventions worth recalling next session (this paper's house style, venue, persona tuning).

### Reviewers

The panel is N domain-expert HOLISTIC reviewers (default 3, range 2-4), assigned at runtime to the paper's subfields, all sharing a senior-reviewer gatekeeper core (harsh, precise, constructive; separate fatal flaws from fixable nits; reason across sections). When a reviewer slot cannot be confirmed (headless, unverifiable), that slot degrades to a generic gatekeeper (one bad slot never degrades the whole panel); the generic fallback lenses are:

- **Theory / Foundations**: definitions, proof gaps, notation, invariance/optimality/generality claims.
- **Empirical / Benchmark**: baseline fairness/vintage, metric correctness, dataset splits, variance, ablation coverage, cherry-picking.
- **Applied / Systems**: practicality, efficiency/latency/memory claims, reproducibility, deployment realism, scaling.

(These are an unordered tendency, not fixed slots; reviewer IDs `R1..RN` are positional, assigned by subfield order.)

The writing toolkit names (prompt bodies not shown here): `translate-to-english`, `polish-english`, `de-ai`, `compress`, `expand`, `caption`, `experiment-analysis`, `logic-check`.

---

## The six hard rules

1. **Never edit the manuscript without explicit author sign-off.** Auto-mode carve-out: the rule HOLDS; auto satisfies it via UP-FRONT sign-off (the `spine` + reviewer-assignment confirmation plus the pre-authorized bounded-aggressive policy) plus the return queue, not per-edit sign-off.
2. **Reviewers / jurors are isolated.** Fresh eyes per round: no cross-talk, no prior-round leakage, no sight of the `ledger`. Enforced by (a) what goes into each agent's prompt AND (b) an explicit ISOLATION instruction in every reviewer-type prompt.
3. **Every valid-fixable issue carries a `close_criterion`** (one concrete sentence describing what an edit must satisfy), set by the judge.
4. **No leakage into the reviewed text.** Revision logs, back-translations, and self-check verdicts are author-side aids; they never enter the manuscript or any frozen snapshot.
5. **Disagreement resolves through discussion, then override (logged), never a silent dismissal.**
6. **No hardcoded paths or project files in the skill.** Resolve at runtime.

---

## Architecture notes

- The Workflow sandbox has **no filesystem and no subprocess**; that is why all deterministic guards run orchestrator-side via Bash between workflow calls.
- `compile-guard.js` is explicit about what it cannot verify: when it cannot truly compile, it degrades to structural lint and reports `compiled:null`.
- Submission-readiness is cross-mode, two parts: **A** = `compliance-check.js` plus a semantic agent; **B** = a compile-driven layout loop reusing `compile-guard.js` plus Read-on-PDF.

---

## File and path reference

- Engine protocol (every orchestrator seam): `references/review-engine-v3.md`
- Auto protocol: `references/auto-mode.md`
- Personas / writing toolkit / methodology: `references/reviewer-personas.md`, `references/writing-toolkit.md`, `references/methodology.md`
- Ledger schema + status machine: `references/ledger-schema.md`
- Submission compliance: `references/submission-compliance.md`
- Design rationale: `docs/REVIEW_ENGINE_V3_DESIGN.md`
- Scripts dir: `scripts/` (decompose, ledger, journal, apply-patch, anchor-diff, cross-ref, spine, compile-guard, compliance-check)
- Workflows dir: `workflows/` (assign-reviewers, reading-check, coverage-auditor, merge, trial, polish, recall-audit, drafter, edit-audit, meaning-audit, clerk, review-panel)

---

## Credits

The spine and anti-drift design (the anchor logic-transfer audit, the claim register, and the minimal-edit, intent-preserving revision policy) is inspired by [PaperSpine](https://github.com/WUBING2023/PaperSpine), a motivation-driven paper drafting and rewriting skill. PaperSpine is a forward generate/rewrite tool with no adversarial loop; paper-review-loop borrows its anchoring idea and its "deterministic scripts for checkable steps, model agents for judgment" mechanism, then adds the adversarial courtroom review engine on top.
