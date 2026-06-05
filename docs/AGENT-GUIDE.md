# paperjury — agent guide (install, invocation, and the technical model)

> Audience: a coding agent (e.g. Claude Code) that has been asked to install or use
> paperjury / paperjury. This document is optimized for **unambiguous machine
> parsing**, not for human readability. It is the authoritative "how to drive this skill"
> reference. If a statement here conflicts with marketing copy in `README.md`, this file
> and the files it cites win. Source-of-truth files are cited inline; read them when you
> need the full contract.

---

## 0. One-paragraph model

paperjury is a Claude Code **skill** (`SKILL.md` is auto-loaded when the skill is
active). It edits and hardens CS-conference LaTeX papers in **three modes**: `direct-edit`
(draft+apply one LaTeX change), `review` (run an adversarial multi-agent "courtroom" engine
that adjudicates each issue), `auto` (run that engine unattended toward a verifiable goal).
The engine's semantic fan-out steps are **workflows** (`workflows/*.workflow.js`); the
checkable guards are **deterministic Node scripts** (`scripts/*.js`) the orchestrator runs
between fan-out steps. The authoritative engine protocol (with the 14 orchestrator-seam
data contracts) is **`references/review-engine-v3.md`** — read it before running `review`
or `auto`.

---

## 1. Install (verified)

The repo ships a Claude Code **plugin manifest** (`.claude-plugin/plugin.json` +
`.claude-plugin/marketplace.json`, root-as-skill) AND stays usable as a **bare skill
directory** (`SKILL.md` at its root, plus `references/`, `workflows/`, `scripts/`,
`configs/`, `docs/`). Two install routes.

**Plugin route** (Claude Code marketplace), from inside Claude Code:

```text
/plugin marketplace add u7079256/paperjury
/plugin install paperjury@u7079256
```

**Skill route** = make the directory discoverable as a skill:

1. Obtain the repo: `git clone https://github.com/u7079256/paperjury`.
2. Place the cloned directory under a Claude Code skills path:
   - user scope: `~/.claude/skills/<dir>/` (auto-loads for every session), or
   - project scope: `<project>/.claude/skills/<dir>/`.
   The `<dir>` name is irrelevant; discovery is by the presence of `SKILL.md` and its
   frontmatter `name: paperjury`. (On the author's machine it lives at
   `~/.claude/skills/paperjury/`.)
3. Verify: the skill should appear in the session's available-skills list as
   `paperjury`. No build step, no dependency install for the skill itself.

Runtime tools the engine USES (must exist in the host environment, not bundled by the skill):
`node` (all deterministic guards), `git` (diffing), and — only for the
submission-readiness compile loop — a LaTeX toolchain (`latexmk`/`pdflatex`); `compile-guard.js`
degrades to a structural lint and reports `compiled:null` when LaTeX is absent.

The plugin and skill routes are non-exclusive: the same `SKILL.md` at the repo root is
what both use, so a `git clone` into `~/.claude/skills/` and a `/plugin install` resolve
to the identical engine.

---

## 2. The three modes and their exact triggers

`direct-edit` and `review` are **auto-routed by intent** (no command, no keyword). `auto` is
**explicit-only**. Decision rule for the consuming agent:

| Mode | Enter when the user… | What runs | Authoritative protocol |
|---|---|---|---|
| `direct-edit` | asks for ONE concrete LaTeX change ("把这段改紧", "polish this", "把我这段中文写成 LaTeX", "de-AI", "compress to one line") | writing toolkit → `logic-check` → author sign-off → apply. No panel, no ledger. | `SKILL.md` §"Direct-edit mode"; `references/writing-toolkit.md` |
| `review` | asks for critique/hardening: `review` / `critique` / `审稿` / `评审` / `mock-review`, optionally scoped `full` or `passage <section/para/claim>` | the courtroom engine (one round), stopping at the human gates | `references/review-engine-v3.md` |
| `auto` | **explicitly** opts in via `/goal "<verifiable condition>"` (config `mode: auto` only SETS the policy — by itself it does NOT loop across turns, see §3) | the same engine, unattended, multi-round, applying safe fixes + queueing risky ones | `references/auto-mode.md` |

Hard rule: **never self-detect `auto`** — it is entered only by an explicit `/goal` context
or a config `mode: auto`. There is no runtime signal that means "go autonomous".

Do NOT use this skill for: drafting a paper from scratch (`ml-paper-writing`), figure/diagram
generation (`academic-plotting`), or an official-venue rebuttal.

---

## 3. `auto` mode vs `/goal` vs Claude Code "auto permission mode" — three different things (verified)

This is the most commonly conflated point. Keep three layers distinct:

| Layer | What it is | Scope | Provides |
|---|---|---|---|
| Claude Code **auto permission mode** | a tool-approval mode in the host (often called "auto"/"放行") | within ONE turn | removes per-TOOL approval prompts. Does NOT continue across turns. |
| paperjury **`auto` mode** (`mode: auto`) | this skill's 3rd mode = a POLICY | per candidate edit | the bounded-aggressive apply rule (apply a safe fix iff it meets `close_criterion` + edit-safety + within the rounds-cap + not an anchor; else QUEUE) + the anti-drift envelope. Sets WHAT happens to each issue. Does NOT itself loop across turns. |
| **`/goal`** | a Claude Code native feature = a multi-turn DRIVER | across MANY turns | a verifiable completion condition + an independent evaluator after each turn + AUTO-CONTINUE to the next turn until the condition holds. This is what makes the loop run unattended. |

Consequences (load-bearing for running `auto`):
- The full unattended **multi-round convergence** (一审 → … → 终审) = **`mode: auto` POLICY + `/goal` DRIVER**.
- `mode: auto` + a single prompt, **without** `/goal`, runs the policy **within one turn**
  (decide apply-vs-queue per issue, journal edits, build the queue) but does **NOT**
  auto-continue across rounds — it stops and waits, exactly like any normal turn.
- Claude Code "auto permission mode" alone only removes tool prompts; it neither runs the
  engine nor loops.
- Completion is deterministic: `node scripts/ledger.js gate <ledger.json>` → PASS iff 0
  gate-blocking active major (author-required / queued / dropped / closed are gate-OK). The
  `/goal` evaluator checks this ledger fact; it does not re-run the audits. Termination:
  clerk convergence (primary) OR applied-quiescence (K dry rounds) OR a hard limit.
  Full contract: `references/auto-mode.md`.

If you are asked to "run auto", the correct invocation is a **`/goal`** with a verifiable
condition (e.g. `/goal "ledger.js gate passes: 0 gate-blocking active major"`). `/loop` is
an alternative multi-turn driver; a plain prompt is not. Bootstrap, in order:

1. **Resolve inputs at runtime** (SKILL.md §"Resolving inputs"): discover the manuscript
   (the `.tex` with `\documentclass`/`\begin{document}`, or the file the user names — ask if
   ambiguous), the venue, and the ledger path. The ledger defaults to
   `<manuscript-dir>/.paper-review/LEDGER.json` (created on first intake by `ledger.js`); use
   that path wherever this doc writes `<ledger.json>`. A project may pin inputs via a config in
   ITS OWN repo (`configs/config-template.md` for the shape); the skill ships none.
2. **Up-front human steps (BEFORE `/goal`, blocking):** (a) freeze the spine (`spine.js`,
   author confirms the anchors); (b) confirm the reviewer assignment (`assign-reviewers`, author
   confirms the N domains or pins them). These are the two pre-authorized sign-offs that satisfy
   hard rule 1 for the unattended run; there is no live human gate once the loop starts.
3. **Then** start the `/goal`. The first round runs `decompose` → the engine; the evaluator
   reads `node scripts/ledger.js gate <ledger.json>` after each turn. All `node scripts/*.js`
   guards run from the installed skill directory, against the resolved manuscript/ledger paths.

---

## 4. Does using this skill require the "workflow" keyword or ultracode? (verified, with a caveat)

Two facts that must both be held:

1. **By design, no keyword is needed.** `SKILL.md` (§"The three primitives", §"Why fan-out
   is a Workflow…") specifies that the engine's fan-out steps run as **Workflows**
   (`workflows/*.workflow.js`), launched by the skill's own instructions once `review`/`auto`
   is entered. The user never types "workflow"; `review` enters on intent words, `auto` on
   `/goal`. The token "ultracode" inside `SKILL.md` §"Maximizing it under ultracode" is an
   internal **args toggle** for loop intensity (`on` → `{maxRounds:4, dryStop:2, verify:true}`;
   `off` → `{maxRounds:1, verify:false}`), **not** a user-typed launch keyword and **not** the
   Claude Code ultracode mode.
2. **But the Workflow tool itself is gated.** It is a research-preview tool, available only on
   paid plans (Pro/Max/Team/Enterprise) and specific providers, and host harnesses differ on
   whether a skill's own instructions auto-authorize it (this Claude Code's Workflow contract
   *does* treat "a skill whose instructions tell you to call Workflow" as a valid opt-in;
   other configs may require the user to opt in, or may not expose Workflow at all).

**Launch routing for the consuming agent — do this:**

1. **Preferred:** run each fan-out step as a Workflow (`workflows/*.workflow.js`) per
   `references/review-engine-v3.md`, with the deterministic Node guards run orchestrator-side
   (via Bash) between calls. No user keyword needed where the host authorizes skill-driven
   Workflow.
2. **Fallback when Workflow is unavailable or not authorized** (free plan / research-preview
   off / host requires an explicit opt-in you do not have): spawn the **same** N reviewers /
   jurors as **parallel `Agent`/`Task` subagents in a single message**, each with the same
   ISOLATED prompt (hard rule 2). You lose the script-orchestration convenience but keep the
   panel/jury semantics; the deterministic guards (`scripts/*.js`) still run orchestrator-side.
   The `Agent`/`Task` path needs no extra opt-in once the skill is invoked.
3. The user may force the Workflow path by adding "workflow"/"ultracode" to their request or
   running `/effort ultracode`; that is optional, not required.

ultracode (the Claude Code mode, `/effort ultracode`) is a **user-controlled session toggle**
and **cannot be defaulted-on by a skill**. This skill does not need it; it orchestrates its own
fan-out. Running under ultracode only makes the host more eager to use Workflow generally —
orthogonal to this skill's own loop, which is controlled by the args toggle in fact (1).

---

## 5. The engine (review + auto share it) — the v3 pipeline

Authoritative: `references/review-engine-v3.md` (protocol + 14 seam contracts);
`docs/REVIEW_ENGINE_V3_DESIGN.md` (rationale); `references/ledger-schema.md` (state machine).

One round, in order:

```
decompose            [det]  split manuscript → reading units + stable passage_ids
spine (once)         [det+human]  extract anchors → author confirm → freeze (the up-front
                            human step; for auto it is confirmed BEFORE the /goal loop starts)
assign-reviewers     [WF]   name N subfields (2–4, default 3); instantiate N holistic domain
                            reviewers from the project gatekeeper core + a generated overlay;
                            an unconfirmable slot degrades PER SLOT to a generic gatekeeper
                            (one bad slot never degrades the whole panel)
reading-check        [WF]   each reviewer reads the WHOLE paper → weaknesses
                            {significance(major|minor), kind(mechanical|substantive),
                            verbatim quote — cannot quote = did not read} + one
                            overall_confidence + a per-section coverage report
anti-skim L1/L2/L3   [det+WF]  L1 per-section quote-verify; L2 coverage-auditor flags
                            skimmed (reviewer,section) pairs; L3 targeted re-invoke
merge                [WF]   semantic dedup; derive significance(MAX) / kind(substantive-
                            dominates) / corroboration(raised_by_count)
route                [det]  mechanical → polish; substantive&minor → polish;
                            substantive&major → trial
trial                [WF]   5 jurors (tier-1): whole-paper DEFENSE → decorrelated LOCAL-context
                            jurors (+on-demand expansion) → deterministic verdict: decide iff
                            quorum (surviving ≥ ceil(0.8·jurySize)) AND one side > 60% of
                            surviving votes; else escalate to 12. Verdicts:
                            invalid-drop | valid-fixable | author-required | escalate.
                            close_criterion is set HERE by the judge, only for valid-fixable,
                            satisfiable by editing existing text (no new data).
polish               [WF]   off-gate track for mechanical + minor-substantive; a flagged item
                            is queued, never SILENTLY dropped (route fans issues into two
                            PARALLEL tracks — polish vs trial — not a single linear sequence)
recall-audit         [WF]   Mode A revives wrongly-dropped charges; Mode B spot-checks
                            strong-consensus majors BEFORE the edit. Runs BEFORE the drafter.
drafter              [WF]   minimal-edit patch per surviving valid-fixable
edit-safety          [det+WF] anchor-diff + cross-ref pre-filter: LOW → apply under compile-
                            guard; RISKY anchor → meaning-audit (four-state); RISKY non-anchor
                            → edit-audit; drift → revert + queue
clerk                [WF]   round boundary: reconcile carried open-questions vs this round's
                            edits via a deterministic passage_id+similarity merge key; emit
                            convergence counts. (The clerk is a SEMANTIC workflow; it is NOT
                            the deterministic orchestrator that runs the guards.)
```

- GATE (completion fact): `node scripts/ledger.js gate` = 0 gate-blocking active major,
  where gate-blocking = {raised, in-trial, re-trial, valid-fixable}; author-required / queued
  / dropped / closed are gate-OK and author-required ACCUMULATES to the human queue.
- `review` stops at the human gates and does not auto-advance. `auto` runs the outer loop
  under `/goal` until clerk convergence / applied-quiescence / a hard limit.

DELETED vs the older v2 engine: a `grand-jury` screen (its "addressed elsewhere" catch moved
into the trial's whole-paper defense). If you find v2-era wording elsewhere (e.g. a
"discussion/tiebreak" panel flow, or "every issue must carry a close_criterion"), prefer this
§5 + `review-engine-v3.md`.

---

## 6. Deterministic guards (orchestrator-side, Node via Bash — the Workflow sandbox has no fs)

Run these between fan-out steps; never inside a workflow. CLI + module API each.

| script | role |
|---|---|
| `scripts/decompose.js` | manuscript → reading units + stable `passage_id`s + canonical section list |
| `scripts/ledger.js` | JSON ledger + MD view; `gate` = the completion fact; `docket`/`unadjudicated` queries |
| `scripts/journal.js` | append-only per-edit revert log |
| `scripts/apply-patch.js` | atomic apply + journal of a drafted patch; exact-once guard on `before` text |
| `scripts/anchor-diff.js` | locate frozen spine anchors; flag which need a meaning audit |
| `scripts/cross-ref.js` | edit-safety pre-filter: does a CHANGED salient token appear in OTHER passages? |
| `scripts/spine.js` | freeze extracted anchors into `spine.json` |
| `scripts/compile-guard.js` | real LaTeX compile or degraded structural lint (`compiled:null`) |
| `scripts/compliance-check.js` | submission-readiness desk-reject screening |

Build gotcha (load-bearing): this harness delivers a workflow's `args` as a **JSON STRING**.
Every workflow parses it defensively (`const A = typeof args === 'string' ? JSON.parse(args) : (args||{})`).
Reviewer/juror/judge prompts carry an explicit ISOLATION line (hard rule 2).

---

## 7. Hard rules (invariants — do not violate)

1. Never edit the manuscript without explicit author sign-off. `auto` carve-out: satisfied by
   UP-FRONT sign-off (spine confirmation + reviewer-assignment confirmation + the pre-authorized
   bounded-aggressive policy) + the return queue, not per-edit sign-off.
2. Reviewers / jurors are isolated: no cross-talk, no prior-round leakage, no sight of the
   ledger — enforced by what is in the prompt AND an explicit ISOLATION instruction.
3. A `valid-fixable` issue carries a `close_criterion`, set by the judge, satisfiable by editing
   existing text.
4. No leakage into the reviewed text (revision logs / back-translations / self-checks stay author-side).
5. Disagreement resolves through discussion, then override (logged), never a silent dismissal;
   any fix touching a frozen spine anchor is queued.
6. No hardcoded paths or project files in the skill; resolve every input at runtime.

---

## 8. File map (read deeper here)

| Need | File |
|---|---|
| Operating manual (auto-loaded) | `SKILL.md` |
| Engine protocol + 14 seam contracts | `references/review-engine-v3.md` |
| Engine design rationale | `docs/REVIEW_ENGINE_V3_DESIGN.md` |
| Auto-mode operational checklist | `references/auto-mode.md` |
| Ledger schema + status machine | `references/ledger-schema.md` |
| Reviewer personas (+ degrade fallback) | `references/reviewer-personas.md` |
| Writing toolkit (8 edit prompts) | `references/writing-toolkit.md` |
| Submission readiness | `references/submission-compliance.md` |
| Deterministic guards | `scripts/` |
| Fan-out workflows | `workflows/` |
| Project config shape (optional, project-owned) | `configs/config-template.md` |

When in doubt, an agent should READ the cited file rather than guess; every input is resolved
at runtime, so there is no hidden global state to infer.
