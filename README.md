**English** · [中文](README.zh-CN.md)

# paper-review-loop

> A portable paradigm for editing and hardening any CS-conference paper, in three modes.

A Claude Code skill (v0.4.0) that edits and hardens CS-conference papers. It is one skill exposing three modes (direct-edit, review, auto), backed by a courtroom-style review engine and deterministic guards.

**Status (2026-06-01):** all three modes are BUILT and component-verified, but NOT yet validated end-to-end on a real paper. The only run was one synthetic planted-flaw passage. 整链未实跑 (the full pipeline has NOT been run end-to-end).

Interactive overview: see [`docs/overview.html`](docs/overview.html), served as the GitHub Pages site.

---

## What and why

**What:** one skill, three modes (direct-edit, review, auto), backed by a courtroom-style review engine and deterministic guards.

**Why this design:**

- One paradigm spanning quick LaTeX edits through adversarial multi-agent review, instead of separate tools.
- Adversarial-by-construction review: a harsh, precise, constructive reviewer panel that separates fatal flaws from fixable nits.
- Human gates and author sign-off are first-class, not bolted on.
- Durable cross-round, cross-session state via a machine-readable `ledger`.

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
- **Behavior:** runs the courtroom review engine (`references/review-engine-v2.md`).
- **Scope sub-trigger:** `full` (whole paper) or `passage` (one section / paragraph / claim).

### Auto (unattended)

- **Trigger (explicit only):** you opt in via `/goal` (or config `mode: auto`) to run the review-revise loop AFK toward a verifiable goal.
- **Hard constraint:** **never self-detect auto; it is explicit only.** Auto never self-detects headless (no runtime signal). Opt in via `/goal` context or a project config `mode: auto`.
- **Behavior:** establish the `spine` up front (the one human step), then the engine applies safe fixes under the bounded-aggressive policy and queues the rest. See `references/auto-mode.md`.
- **Note:** `/goal` is a real Claude Code feature (v2.1.139, May 2026), verified present.

---

## How to trigger / quick start

Say what you want; the skill routes to a mode:

- Want a direct LaTeX edit → just describe the change (e.g., "polish this paragraph", "把这段改成…"). → **Direct-Edit mode.**
- Want critique or hardening → say review / critique / 审稿 / 评审 / mock-review, optionally scoped `full` or `passage`. → **Review mode.**
- Want an unattended loop toward a goal → opt in explicitly via `/goal` or config `mode: auto`. → **Auto mode.**

> **Install / setup:** not documented here yet. The installation steps, CLI invocation string, repo path setup, and the config-file format/location beyond the literal key `mode: auto` are to be filled in by the maintainer.

---

## Engine overview

The courtroom engine is `reading-check → grand-jury → trial → drafter → recall-audit`, with `meaning-audit` alongside. The **deterministic guards in `scripts/`** run orchestrator-side via Bash between workflow calls, because the Workflow sandbox has no filesystem and no subprocess.

### Deterministic stages (orchestrator-side, Node via Bash)

1. `decompose`: split manuscript into reading units and stable `passage-id`s. *(Built; tested via Bash.)*
2. `spine` (auto only): extract anchors, author confirm, freeze → `spine.json`; assigns anchor_ids; resolves to passage_ids. *(Built; tested.)*
3. `ledger.js`: JSON ledger plus MD view; **gate = `/goal` completion fact** (0 active blocker/major). CLI: init/add/set/count/gate/get/render. *(Built + tested end-to-end.)*
4. `journal.js`: append-only per-edit revert log (JSONL); reversible by exact-string revert. *(Tested.)*
5. `apply-patch.js`: atomic apply plus journal of a drafted patch, and revert (exact-once guard on `before` text); emits `issue_id`. *(Tested; contract fixed with drafter.)*
6. `anchor-diff.js`: locate frozen anchors; flag which `need_audit` when the support region changed; emits both `present_verbatim` and `anchor_present_verbatim`. *(Tested; contract mismatch with meaning-audit fixed.)*
7. `compile-guard.js`: real LaTeX compile (latexmk/pdflatex) or degraded structural-lint path with `compiled:null` (honest unverifiability); rollback signal. *(Tested.)*
8. `compliance-check.js`: submission-readiness A: deterministic desk-reject screening (anonymization, page limit, required sections, documentclass). *(Tested via Bash.)*

### Semantic stages (workflow fan-out)

All seven workflows are **run-verified on one synthetic planted-flaw passage** (not on a real paper):

1. `reading-check`: prosecution: per-(unit × lens) charges plus cross-unit plus quote-verify, loop-until-dry. Catches abstract-vs-experiments mismatch.
2. `grand-jury`: cheap low-bar screen (Haiku); drop only obviously-invalid charges.
3. `trial`: defense → decorrelated jury → judge; three-way routing (valid-fixable / invalid-drop / author-required). Judge routing fixed: needs-data → author-required only.
4. `drafter`: minimal-edit patch for valid-fixable charges, or honest text-softening for needs-data, or escalate; emits `issue_id`.
5. `recall-audit`: fresh skeptic re-checks every drop; revive wrongly-dropped real issues; four-state audit.
6. `meaning-audit`: four-state spine drift audit; **advisory in review, gating in auto.** Catches contradicted anchors; passes faithful rewrites.

Also present: `review-panel.workflow.js`: the quick/legacy simple 3-lens panel (fast path); smoke-tested on the synthetic planted-flaw passage.

**Synthetic-test facts (one synthetic passage only, never a real-paper result):** the v2 run used ~44 agents, ~5 min, caught all planted flaws plus high-quality extras, cost ~1.35M subagent tokens. A separate 13-dimension cross-check (~50 agents, ~1.9M tokens) found and fixed 32 issues, including 2 integration-contract desyncs that the per-component tests had masked.

---

## The three primitives: Skill + Workflow + Memory

1. **Skill (entry point + methodology):** the protocol, the reviewer panel, the consensus gate, the writing toolkit, the human gates. Detail in `references/methodology.md`, `references/reviewer-personas.md`, `references/writing-toolkit.md`.

2. **Workflow (fan-out engine):** the semantic, no-human-in-the-middle steps run as Workflows (parallelism plus schema-validated output by construction). Simple panel = `workflows/review-panel.workflow.js`; courtroom engine = `reading-check → grand-jury → trial → drafter → recall-audit` (plus `meaning-audit`). The deterministic guards run orchestrator-side via Bash between workflow calls because the Workflow sandbox has no fs: `scripts/` holds `decompose`, `ledger`, `journal`, `apply-patch`, `anchor-diff`, `spine`, `compile-guard`, `compliance-check`.

3. **Memory (durable state + learned conventions), two layers:**
   - **Ledger**: `LEDGER.json` resolved at runtime = the machine source of truth, plus a rendered `LEDGER.md` view; managed by `scripts/ledger.js`. The live, mutable issue state across rounds and sessions. Schema plus status state machine: `references/ledger-schema.md`.
   - **Claude memory**: the active project's memory: stable conventions worth recalling next session (this paper's house style, venue, persona tuning).

### Courtroom lenses

All share a senior-reviewer core (harsh, precise, constructive; separate fatal flaws from fixable nits). Three default lenses:

- **R1 Theory/Foundations**: definitions, proof gaps, notation, invariance/optimality/generality claims.
- **R2 Empirical/Benchmark**: baseline fairness/vintage, metric correctness, dataset splits, variance, ablation coverage, cherry-picking.
- **R3 Applied/Systems**: practicality, efficiency/latency/memory claims, reproducibility, deployment realism, scaling.

The writing toolkit names (prompt bodies not shown here): `translate-to-english`, `polish-english`, `de-ai`, `compress`, `expand`, `caption`, `experiment-analysis`, `logic-check`.

---

## The six hard rules

1. **Never edit the manuscript without explicit author sign-off.** Auto-mode carve-out: the rule HOLDS; auto satisfies it via UP-FRONT sign-off (the `spine` confirmation plus the pre-authorized bounded-aggressive policy) plus the return queue, not per-edit sign-off.
2. **Reviewers / jurors are isolated.** Fresh eyes per round: no cross-talk, no prior-round leakage, no sight of the `ledger`. Enforced by (a) what goes into each agent's prompt AND (b) an explicit ISOLATION instruction in every reviewer-type prompt.
3. **Every issue carries a `close_criterion`** (one concrete sentence describing what an edit must satisfy). Issues without one are dropped at merge.
4. **No leakage into the reviewed text.** Revision logs, back-translations, and self-check verdicts are author-side aids; they never enter the manuscript or any frozen snapshot.
5. **Disagreement resolves through discussion, then override (logged), never a silent dismissal.**
6. **No hardcoded paths or project files in the skill.** Resolve at runtime.

---

## Architecture notes

- The Workflow sandbox has **no filesystem and no subprocess**; that is why all deterministic guards run orchestrator-side via Bash between workflow calls. This is a design fact, not a limitation to apologize for.
- `compile-guard.js` is honest about unverifiability: when it cannot truly compile, it degrades to structural lint and reports `compiled:null`.
- Submission-readiness is cross-mode, two parts: **A** = `compliance-check.js` plus a semantic agent (deterministic plus semantic desk-reject checks); **B** = a compile-driven layout loop reusing `compile-guard.js` plus Read-on-PDF (no rasterizer available, so the PDF page is read directly). A is tested; B reuses already-tested components.

---

## Honest caveats

Status as of 2026-06-01. "Built + component-verified" is kept strictly separate from "validated end-to-end on a real paper."

**What is built and component-verified:**

- All three modes (direct-edit, review/v2, auto) are **BUILT**.
- 8 deterministic scripts: tested in isolation via Bash.
- 7 workflows: each **run-verified on one synthetic planted-flaw passage**.
- The deterministic `apply → compile → journal → revert` chain: end-to-end **in isolation**.
- `ledger.js`: built + tested end-to-end as a component.

**What is NOT yet done (stated plainly):**

- **整链未实跑**: the full pipeline has NOT been run end-to-end on a real paper.
- Full v2 pipeline on a real draft/final pair: **NOT YET DONE** (real-paper validation pending).
- Auto mode's full loop on a real paper (`applied-quiescence` → `ledger.js gate` PASS → queue reconciliation): **full loop NOT run end-to-end**.
- Real-scale batch behavior (~600 agents/invocation): not yet validated.

**Per-mode caveats:**

- **Direct-Edit:** BUILT; component smoke-tested; **not run end-to-end on a real paper**.
- **Review/v2:** BUILT and component-verified; the only run was one synthetic planted-flaw passage; **整链端到端 validation not yet done**.
- **Auto:** BUILT (engine + envelope); **full v2 pipeline and the auto loop on a real paper not run end-to-end**.

**Bottom line:**

> All three modes are BUILT and component-verified, but NOT yet validated end-to-end on a real paper. The synthetic-passage smoke test was thorough (caught all planted flaws, high-quality extras, 44–50 agents, a 13-dimension cross-check found and fixed 32 issues including 2 masked integration desyncs), but that is not proof of correctness on a 10-page real draft.

This skill does not claim "production-ready", "validated", or "proven on real papers". No recall/precision numbers, real-paper cost figures, or adoption are claimed; none have been measured yet.

---

## File and path reference

- Engine protocol: `references/review-engine-v2.md`
- Auto protocol: `references/auto-mode.md`
- Methodology / personas / writing toolkit: `references/methodology.md`, `references/reviewer-personas.md`, `references/writing-toolkit.md`
- Ledger schema + status machine: `references/ledger-schema.md` (referenced; schema body not inlined here)
- Submission compliance: `references/submission-compliance.md`
- Scripts dir: `scripts/` (decompose, ledger, journal, apply-patch, anchor-diff, spine, compile-guard, compliance-check)
- Workflows dir: `workflows/` (drafter, grand-jury, meaning-audit, reading-check, recall-audit, review-panel, trial)

---

## Credits

The spine and anti-drift design (the 7-anchor logic-transfer audit, the claim register, and the minimal-edit, intent-preserving revision policy) is inspired by [PaperSpine](https://github.com/WUBING2023/PaperSpine), a motivation-driven paper drafting and rewriting skill. PaperSpine is a forward generate/rewrite tool with no adversarial loop; paper-review-loop borrows its anchoring idea and its "deterministic scripts for checkable steps, model agents for judgment" mechanism, then adds the adversarial courtroom review engine on top.

---

*Built + component-verified as of 2026-06-01. Not yet validated end-to-end on a real paper. 整链未实跑. This README states only what is in place; it does not prejudge correctness on a real paper.*
