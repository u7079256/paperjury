# Submission readiness (desk-reject shield + compile-driven layout)

Two cross-mode guards (SUBMISSION_READINESS_DESIGN). Both follow the skill split:
the skill carries the generic PROCEDURE + checker scripts; anything venue-specific
lives in the PROJECT, never in the skill.

## A. Template compliance (desk-reject shield)

Three steps: identify, report-link, check. The skill NEVER bundles a template and
NEVER auto-swaps one.

### A.1 Identify + report the source link (human confirms)
An agent detects the venue / year / track from the `.tex` (class/style file, e.g.
`cvpr.sty`, `neurips_2026.sty`), searches for the official current template + author
guidelines, and REPORTS the specific source link(s) with a verdict, e.g. "your doc
uses `neurips_2025.sty`; the 2026 CFP uses `neurips_2026.sty` <link> -- mismatch,
confirm your target year." The agent never trusts an auto-found template on its own
(web/Overleaf copies are frequently stale). On the author's say-so only, fetch the
official template to a SIDE location (never over the working `.tex`) and produce a
migration plan with sign-off.

### A.2 The project-owned constraints file
Recorded once at confirmation, then every later edit is checked against it. Lives in
the PROJECT (proposed `<manuscript-dir>/.paper-review/template-constraints.json`):

```json
{ "venue": "neurips-2026", "anonymous": true, "page_limit": 9,
  "required_sections": ["Limitations"], "documentclass": "neurips_2026",
  "allowed_documentclass_options": ["final"] }
```

### A.3 The checker (deterministic + semantic)
- **Deterministic**: `scripts/compliance-check.js <tex> <constraints.json> [--pages N]`.
  Flags non-anonymized `\author`/`\thanks`/acknowledgments/self-reference/code-URLs/
  emails (when `anonymous`), margin/spacing hacks (negative `\vspace`, `\setlength`/
  `\addtolength` on page geometry, reduced line spacing), `\documentclass` identity +
  option drift, missing required sections, and page-limit overflow (only with a real
  `--pages` count from `compile-guard.js`; it never guesses). Exit 0 iff no
  blocker/major. Use as a pre-submission gate or, in auto, as a guard.
- **Semantic (agent)**: the deterministic flags are candidates; an agent then judges
  the genuinely semantic calls. Prompt:
  > You are checking a double-blind submission for de-anonymization. For each flagged
  > item (a self-citation, an acknowledgment, a URL, a footnote), decide whether it
  > actually reveals author identity or affiliation, and how to fix it minimally
  > (anonymize the citation as third-person, remove the acknowledgment, use an
  > anonymized mirror). Do not over-flag generic related-work citations.

### A.4 Cross-mode use
- direct-edit / review: run the checker on demand or as a pre-submission gate.
- auto: the constraints file is another guard. An edit that pushes over the page
  limit or breaks anonymization is blocked / queued, exactly like the compile guard.
  Anonymization and page limit are HARD; auto never trades them for a content fix.

## B. Compile-driven layout adjustment

The recurring failure: the author says "move this figure/table to X", the assistant
edits the source, claims "done", but the compiled PDF is unchanged (float specifiers
are hints, not commands; spanning `figure*`/`table*` ignore `h`/`b`; wrong instance;
stale view; or the assistant never looked at the PDF). Layout fine-tuning is a
DIRECT-EDIT + local-LaTeX + human-present activity; auto mode does NOT do visual
layout micro-tuning.

### B.1 Close the loop on the RENDERED artifact
```
compile -> render/Read the relevant page(s) -> LOOK -> locate the float
        -> pick the RIGHT lever -> recompile -> LOOK again -> VISUALLY verify it moved
        -> only then claim done; else try the next lever
```
The verification must be VISUAL (read the rendered page), not textual ("I edited the
source"). On THIS machine: `compile-guard.js check` compiles (texlive present) and
returns the PDF path; there is NO PNG rasterizer (pdftoppm/mutool/magick absent), so
READ THE PDF PAGE DIRECTLY with the Read tool (it ingests PDF pages as real
multimodal vision, not OCR). Render to PNG only if a rasterizer is later installed
and a dense page needs finer resolution.

### B.2 What vision is reliable for (hybrid verify)
- **Vision (reliable)**: coarse / relative / structural -- moved or not, top vs
  bottom, spanning vs single-column, overflow past the text block, a new large
  whitespace gap, a caption split from its float, one vs two columns.
- **Vision (unreliable)**: exact metrics (mm margins, pt spacing, pixel positions).
  Those come from deterministic tools: the compile LOG (overfull/underfull,
  "float too large") via `compile-guard.js`, and page count from the same.
The author's pain ("the float is not where I want it") is a relative/structural
judgment, which vision handles well.

### B.3 The lever box (pick a lever that CAN work)
- `[H]` (needs `float` package): hard "here", no floating -- often the true intent.
- `[!t]`: override some placement restrictions.
- `\FloatBarrier` (placeins) / `\clearpage`: flush pending floats before a section.
- Move the float's SOURCE position in the `.tex` (LaTeX queues floats at/after their
  definition point).
- Two-column spanning floats (`figure*`/`table*`) accept only `[t]`/`[p]`, never
  `h`/`b` -- a frequent "it won't move" trap.

### B.4 Detect-or-degrade + the honesty rule
- With local LaTeX: run the full visual loop and verify visually before claiming done.
- Without local LaTeX: do NOT claim verified. Make the best-lever change and say so:
  "float placement is a hint; I cannot confirm it moved without compiling -- compile
  and check, or let me compile on Overleaf."
- **Honesty rule**: replace "done" with exactly one of (a) visually verified it moved,
  or (b) "changed the source, but float placement is a suggestion and I cannot
  confirm it moved without a compile." Never an unverified success claim. This is the
  no-overclaim rule applied to layout: re-derive the checkable fact (by looking at the
  render) before asserting a status.
