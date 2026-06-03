**English** · [中文](README.zh-CN.md)

# paper-review-loop

> A portable paradigm for editing and hardening any CS-conference paper, in three modes.

<p align="center">
  <a href="https://u7079256.github.io/papercourt/overview.html?lang=en"><img alt="Open the live interactive overview" src="https://img.shields.io/badge/Open_the_interactive_overview-d6a14b?style=for-the-badge&logo=githubpages&logoColor=white"></a>
</p>

A Claude Code skill that edits and hardens CS-conference papers. It is one skill exposing three modes (direct-edit, review, auto), backed by a courtroom-style review engine and deterministic guards.

**Status:** All three modes are built and the engine is adversarially cross-checked, but not yet validated end-to-end on a real paper.

Interactive overview: the [live site](https://u7079256.github.io/papercourt/overview.html?lang=en) (GitHub Pages), or [`docs/overview.html`](docs/overview.html) in-repo.

---

## What and why

**What:** one skill, three modes (direct-edit, review, auto), backed by a courtroom-style review engine and deterministic guards.

**Why this design:**

- One paradigm spanning quick LaTeX edits through adversarial multi-agent review, instead of separate tools.
- Adversarial-by-construction review: harsh, precise, constructive domain reviewers that separate fatal flaws from fixable nits.
- Routing by CONTESTABILITY, not severity: deep deliberation is spent only where a charge is genuinely contested; mechanical and minor issues take a cheap polish track.
- Human gates and author sign-off are first-class, not bolted on.
- Durable cross-round, cross-session state via a machine-readable `ledger`, with a clerk-converged multi-round loop.

No adoption, benchmarks, or real-paper results exist yet; do not infer any (see [Honest caveats](#honest-caveats)).

## Scope

**CS conferences only.** Three venue families, each with its own style profile:

- **Vision:** CVPR, ICCV, ECCV, WACV
- **NLP:** ACL, EMNLP, NAACL, COLING
- **ML:** ICLR, NeurIPS, ICML, AAAI, COLM

Scope is exactly these three families and these venue names: no journals, systems venues, or workshops.

---

## Three modes

All three modes are **BUILT**. Per-mode verification caveats are in [Honest caveats](#honest-caveats); they apply wherever a mode is presented as usable.

### Direct-Edit (common)

- **Trigger:** you describe a change in Chinese or English and want the LaTeX edited directly.
- **Example utterances:** "把这段改成…", "polish this paragraph", "把我对 intro 的想法写成 LaTeX", "tighten this".
- **Behavior:** no review panel; go straight to drafting the patch through the writing toolkit, with author sign-off.

### Review (occasional)

- **Trigger:** you want the paper critiqued or hardened: review / critique / 审稿 / 评审 / mock-review, or iterating a draft to clear reviewer-raised issues.
- **Behavior:** runs the courtroom review engine (`references/review-engine-v3.md`).
- **Scope sub-trigger:** `full` (whole paper) or `passage` (one section / paragraph / claim).

### Auto (unattended)

- **Trigger (explicit only):** you opt in via `/goal` (or config `mode: auto`) to run the review-revise loop AFK toward a verifiable goal.
- **Hard constraint:** **never self-detect auto; it is explicit only.** Auto never self-detects headless (no runtime signal). Opt in via `/goal` context or a project config `mode: auto`.
- **Behavior:** establish the `spine` and the reviewer assignment up front (the human steps), then the engine applies safe fixes under the bounded-aggressive + edit-safety policy, queues the rest, and runs multiple rounds until a clerk-converged stop. See `references/auto-mode.md`.
- **Note:** `/goal` is a real Claude Code feature, verified present.

---

## How to trigger / quick start

Say what you want; the skill routes to a mode:

- Want a direct LaTeX edit → just describe the change (e.g., "polish this paragraph", "把这段改成…"). → **Direct-Edit mode.**
- Want critique or hardening → say review / critique / 审稿 / 评审 / mock-review, optionally scoped `full` or `passage`. → **Review mode.**
- Want an unattended loop toward a goal → opt in explicitly via `/goal` or config `mode: auto`. → **Auto mode.**



---

## Engine overview

The courtroom engine is `assign-reviewers → reading-check → coverage-auditor → merge → {trial (+ escalate) ‖ polish} → recall-audit → drafter → {edit-audit | meaning-audit} → clerk`. Generation is bounded (N holistic domain reviewers, not a per-(unit × lens) flood); adjudication is routed by contestability; edits are guarded by risk; the multi-round loop converges via a deterministic clerk. The **deterministic guards in `scripts/`** run orchestrator-side via Bash between workflow calls.

### Deterministic stages (orchestrator-side, Node via Bash)

1. `decompose`: split manuscript into reading units, the canonical section list, and stable `passage-id`s (the anti-drift substrate and the juror local-context source).
2. `spine` (auto only): extract anchors, author confirm, freeze → `spine.json`.
3. `ledger.js`: JSON ledger plus MD view; **gate = `/goal` completion fact** (0 gate-blocking active major; author-required is gate-OK and accumulates to the human queue). CLI: init/add/set/count/gate/get/docket/unadjudicated/render.
4. `journal.js`: append-only per-edit revert log (JSONL).
5. `apply-patch.js`: atomic apply plus journal of a drafted patch, and revert (exact-once guard on `before` text).
6. `anchor-diff.js`: locate frozen anchors; flag which `need_audit` when the support region changed.
7. `cross-ref.js`: edit-safety risk pre-filter: does a CHANGED salient token in a patch appear in OTHER passages?
8. `compile-guard.js`: real LaTeX compile (latexmk/pdflatex) or a degraded structural-lint path with `compiled:null` (honest unverifiability).
9. `compliance-check.js`: submission-readiness A: deterministic desk-reject screening.

### Semantic stages (workflow fan-out)

1. `assign-reviewers`: name N subfields, instantiate N domain reviewers from the project gatekeeper core + a generated domain overlay; config-pin / verifier / per-slot degrade headless.
2. `reading-check`: N holistic reviewers each read the WHOLE paper once → weaknesses (significance + kind + verbatim quote) + one overall_confidence + a per-section coverage report; targeted re-invoke mode for anti-skim.
3. `coverage-auditor`: anti-skim L2: flag skimmed (reviewer, section) pairs across the coverage reports.
4. `merge`: semantic dedup across reviewers; the workflow derives significance (MAX) / kind (substantive-dominates) / corroboration deterministically.
5. `trial`: the 5-tier: whole-paper defense → decorrelated local-context jury (with on-demand context expansion) → a deterministic quorum/majority verdict + a judge that routes a decided-valid charge (valid-fixable vs author-required); escalate to a 12-juror tier on no clear majority.
6. `polish`: the off-gate track: batch copy-edit (mechanical) + batch light-check (minor-substantive); can escalate a misrouted major back to trial.
7. `recall-audit`: Mode A revives wrongly-dropped charges (bias to revive); Mode B spot-checks strong-consensus majors before the edit (guards a correlated-wrong consensus).
8. `drafter`: minimal-edit patch for valid-fixable charges.
9. `edit-audit` / `meaning-audit`: the edit-safety semantic half: `edit-audit` checks a risky non-anchor edit (make-sense + cross-section alignment); `meaning-audit` is the four-state frozen-anchor + arc audit.
10. `clerk`: the round boundary: reconcile carried open-questions vs this round's edits, dedup re-raises via a deterministic passage_id + similarity merge key, and emit the deterministic convergence counts.

Also present: `review-panel.workflow.js`: the quick/legacy simple 3-lens panel (fast path).

**How the engine was hardened (not a real-paper result):** the design was stress-tested by an adversarial validation workflow, then the built engine was cross-checked by a second workflow with fresh-skeptic verification of each finding. Confirmed defects were fixed and contracts written into `references/review-engine-v3.md`. The core has NOT yet been run end-to-end on a real paper.

---

## The three primitives: Skill + Workflow + Memory

1. **Skill (entry point + methodology):** the protocol, the reviewer assignment, the consensus gate, the writing toolkit, the human gates. Detail in `references/review-engine-v3.md`, `references/reviewer-personas.md`, `references/writing-toolkit.md`.

2. **Workflow (fan-out engine):** the semantic, no-human-in-the-middle steps run as Workflows (parallelism plus schema-validated output by construction). Simple panel = `workflows/review-panel.workflow.js`; the v3 courtroom engine = `assign-reviewers → reading-check → coverage-auditor → merge → {trial ‖ polish} → recall-audit → drafter → {edit-audit | meaning-audit} → clerk`. The deterministic guards run orchestrator-side via Bash because the Workflow sandbox has no fs: `scripts/` holds `decompose`, `ledger`, `journal`, `apply-patch`, `anchor-diff`, `cross-ref`, `spine`, `compile-guard`, `compliance-check`.

3. **Memory (durable state + learned conventions), two layers:**
   - **Ledger**: `LEDGER.json` resolved at runtime = the machine source of truth, plus a rendered `LEDGER.md` view; managed by `scripts/ledger.js`. The live, mutable issue state across rounds and sessions. Schema plus status state machine: `references/ledger-schema.md`.
   - **Claude memory**: the active project's memory: stable conventions worth recalling next session (this paper's house style, venue, persona tuning).

### Reviewers

The panel is N domain-expert HOLISTIC reviewers (default 3), assigned at runtime to the paper's subfields, all sharing a senior-reviewer gatekeeper core (harsh, precise, constructive; separate fatal flaws from fixable nits; reason across sections). When assignment degrades (headless, unconfirmable), the panel falls back to three generic lenses:

- **R1 Theory/Foundations**: definitions, proof gaps, notation, invariance/optimality/generality claims.
- **R2 Empirical/Benchmark**: baseline fairness/vintage, metric correctness, dataset splits, variance, ablation coverage, cherry-picking.
- **R3 Applied/Systems**: practicality, efficiency/latency/memory claims, reproducibility, deployment realism, scaling.

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

- The Workflow sandbox has **no filesystem and no subprocess**; that is why all deterministic guards run orchestrator-side via Bash between workflow calls. This is a design fact, not a limitation to apologize for.
- `compile-guard.js` is honest about unverifiability: when it cannot truly compile, it degrades to structural lint and reports `compiled:null`.
- Submission-readiness is cross-mode, two parts: **A** = `compliance-check.js` plus a semantic agent; **B** = a compile-driven layout loop reusing `compile-guard.js` plus Read-on-PDF. A is tested; B reuses already-tested components.

---

## Honest caveats

Built and adversarially cross-checked, but not yet validated end-to-end on a real paper. "Built and cross-checked" is kept strictly separate from "validated end-to-end on a real paper."

**What is built and verified:**

- All three modes (direct-edit, review, auto) are **built**.
- 9 deterministic scripts; `ledger.js` is unit-tested (22 cases).
- The v3 workflows are syntax-clean and contract-cross-checked by an adversarial workflow with fresh-skeptic verification.
- The deterministic `apply → compile → journal → revert` chain: end-to-end **in isolation**.

**What is NOT yet done (stated plainly):**

- The core has NOT been run end-to-end on a real paper.
- Three-way routing accuracy, the 5-tier trial, the drafter/apply/edit-safety chain on real edits, the clerk convergence, and the `/goal` auto loop: **NOT YET validated on a real paper**.


**Per-mode caveats:**

- **Direct-Edit:** BUILT; component smoke-tested; **not run end-to-end on a real paper**.
- **Review:** Built and cross-checked; **real-paper end-to-end validation not yet done**.
- **Auto:** BUILT (engine + envelope + outer loop); **the full loop on a real paper not run end-to-end**.

**Bottom line:**

> All three modes are built and the engine is adversarially cross-checked, but NOT yet validated end-to-end on a real paper.

This skill does not claim "production-ready", "validated", or "proven on real papers". No recall/precision numbers, real-paper cost figures, or adoption are claimed; none have been measured yet.

---

## File and path reference

- Engine protocol (v3, + every orchestrator seam): `references/review-engine-v3.md`
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

---

*Built and adversarially cross-checked, but not yet validated end-to-end on a real paper.*
