# Submission readiness — design rationale (BUILT 2026-06-01)

Status: design v0 + BUILT 2026-06-01. This doc is the RATIONALE; the operational
procedure is `references/submission-compliance.md`, the A checker is
`scripts/compliance-check.js`, and B reuses `scripts/compile-guard.js` + Read-on-PDF.
Two desk-reject / output-quality guards, distinct from the review/edit loop and from
auto mode; they apply ACROSS modes.

Both follow the skill's split: the skill carries the generic PROCEDURE + a checker
script; anything venue-specific lives in the PROJECT, never in the skill.

## A. Template compliance (desk-reject shield)

### A.0 The problem
Papers get desk-rejected on template issues far more than on content. "Template
confirmation" is really TWO things, and the shield is mostly the second:
- **Template IDENTITY**: the manuscript is built on the correct, current OFFICIAL
  template for the target venue + year + track, and the template internals are not
  modified.
- **Template COMPLIANCE**: the manuscript respects the template's hard constraints:
  page limit, anonymization (double-blind), no margin/spacing hacks, required
  sections (ethics / repro checklist / limitations), reference style.

### A.1 Decisions
- **Do NOT ship a template bundle in the skill (proposal 1 rejected).** A bundled
  template goes stale instantly (templates change yearly; using a stale template is
  itself a desk-reject cause), multiplies across venue x year x track, and violates
  the skill's zero-venue-files rule. Templates are PROJECT-independent.
- **Identify + report the source link for human confirmation (proposal 2, kept).**
  An agent detects the venue / year / track from the `.tex` (class / style file,
  e.g. `cvpr.sty`, `neurips_2026.sty`), searches for the official current template +
  author guidelines, and REPORTS the specific source link(s) with a verdict (e.g.
  "your doc uses `neurips_2025.sty`; the 2026 CFP uses `neurips_2026.sty` <link> —
  mismatch, confirm your target year"). The human confirms the source; the agent
  never trusts an auto-found template source on its own (web copies / Overleaf
  mirrors are frequently stale or wrong).
- **NEVER auto-download-and-swap the template.** Swapping can overwrite the author's
  customizations and version-mismatch the content. If the manuscript is on the wrong
  template: report it; only on the author's say-so fetch the official template to a
  SIDE location (never over the working `.tex`) and produce a migration plan with
  sign-off.
- **Centerpiece = a compliance CHECKER (the actual shield), deterministic + semantic.**
  - deterministic (scriptable): page count vs limit; margin / spacing hacks
    (`\vspace{-...}`, `\setlength` on margins / text dims); `\documentclass` options
    changed vs the pristine template; anonymization leaks (filled author block,
    `\thanks`, acknowledgments, self-reference patterns like "our prior work [X]",
    `github.com` links); required sections present; reference style.
  - semantic (agent): does this self-citation de-anonymize; is this acknowledgment
    identity-revealing.
- **Where it lives (the project-independent split).** Generic PROCEDURE + checker
  script in the skill (proposed: `references/submission-compliance.md` + a `scripts/`
  checker). The extracted per-venue mandatory constraints live in the PROJECT
  (proposed: `<manuscript-dir>/.paper-review/template-constraints.md`, alongside the
  ledger), recorded once at confirmation time so later edits are checked against them.

### A.2 Cross-mode use
- Direct-edit / review: run the checker on demand or as a pre-submission gate.
- Auto: the constraints file becomes another guard auto must respect. An edit that
  pushes over the page limit or breaks anonymization is blocked / queued, exactly
  like the compile-guard (see `AUTO_MODE_DESIGN.md` §3). Anonymization and page
  limit are HARD; auto never trades them for a content fix.

## B. Compile-driven layout adjustment

### B.0 The problem
A recurring failure: the author says "this figure / table is in the wrong place, put
it at X", the assistant edits the source, claims "done", but the compiled PDF is
unchanged. Root causes (the fix depends on which):
1. **Float specifiers are suggestions, not commands.** `[h]` / `[t]` are hints;
   LaTeX's float algorithm decides actual placement, so changing the hint often
   yields an identical PDF. In two-column layouts a `figure*` / `table*` (spanning
   float) silently ignores `h` / `b` entirely. THE main cause; a mental-model
   mismatch ("put it here" vs "I queue floats and place them by my rules").
2. Editing the wrong instance / wrong file (multi-file `\input`, duplicate blocks).
3. Stale view (not recompiled, cached `.aux`).
4. **Deepest: the assistant never looks at the rendered PDF**, so "done" is an
   unverified (and often wrong) claim. Causes 1 to 3 slip through only because of 4.

### B.1 Decision: close the loop on the RENDERED artifact
```
compile -> render the relevant page(s) to image -> LOOK -> locate the float
        -> pick the RIGHT lever -> recompile -> render -> VISUALLY verify it moved
        -> only then claim done; else try the next lever
```
The verification must be VISUAL (read the rendered page), not textual (I edited the
source). That single change removes the false-success failure (cause 4).

### B.2 The assistant's vision capability (why this is feasible)
Claude's image input is REAL multimodal vision, NOT OCR (OCR extracts text and
discards layout). It perceives structure and spatial relations, not just text.
- **Reliable: coarse / relative / structural** — moved or not, top vs bottom,
  spanning vs single-column, overflow past the text block, a new large whitespace
  gap, a caption split from its float, one vs two columns.
- **Unreliable: exact metrics** — mm-level margins, pt-level spacing, pixel-exact
  positions, sub-pixel alignment. Reason: the image is downsampled to a limited
  resolution and Claude reads the raster, not LaTeX's box model.
- So the author's actual pain ("the float is not where I want it") is a RELATIVE /
  structural judgment, which Claude's vision handles well.

### B.3 Hybrid verification
- **Vision (Claude)** judges relative / structural placement: did it move, where is
  it now, did it span, did it overflow, did a whitespace gap appear.
- **Deterministic tools** judge exact constraints: the compile LOG for
  overfull / underfull and "float too large" warnings; `pdfinfo` / PDF geometry for
  page count and margins. Exact numbers never come from Claude's eyes.
This mirrors auto's split (image for relative judgment, deterministic for exact) and
A's checker.

### B.4 The lever box (so the assistant stops pulling levers that cannot work)
- `[H]` (requires the `float` package): hard "here", no floating — often the
  author's true intent for "put it here".
- `[!t]`: override some placement restrictions.
- `\FloatBarrier` (placeins) / `\clearpage`: flush pending floats before a section.
- Move the float's SOURCE position in the `.tex` (LaTeX queues floats at / after
  their definition point; moving the block changes candidacy).
- Two-column spanning floats (`figure*` / `table*`) accept only `[t]` / `[p]`; they
  cannot be `h` / `b`. A frequent "it won't move" trap.
Knowing the box means picking a lever that CAN satisfy the request, or honestly
explaining when the venue's two-column rules make the exact request impossible
(rather than thrashing or pretending).

### B.5 Optional local LaTeX -> must degrade
- **With local LaTeX + a PDF->image renderer** (`pdftoppm` / `mutool draw` /
  ImageMagick `convert`; or Read the PDF page directly): run the full visual loop.
  Render to PNG first when finer resolution is needed on a dense page.
- **Without local LaTeX**: Claude cannot observe output, so it MUST NOT claim
  verified. It makes the best-lever change and says so explicitly: "float placement
  is a hint; I cannot confirm it moved without compiling — compile and check, or let
  me compile on Overleaf." Honest unverifiability replaces a false "done". Same
  detect-or-degrade philosophy as the auto compile-guard.

### B.6 Boundary and the honesty rule
- Layout fine-tuning is a DIRECT-EDIT + local-LaTeX + human-present activity. Auto
  mode does NOT do visual layout micro-tuning (it is content hardening; headless
  visual verification is heavy and brittle).
- **Honesty rule for layout edits**: replace "done" with exactly one of (a) visually
  verified that it moved, or (b) "changed the source, but float placement is a
  suggestion and I cannot confirm it moved without a compile". Never an unverified
  success claim. (This is the general no-overclaim rule applied to layout: re-derive
  the checkable fact — here, by looking at the render — before asserting a status.)

## Where this fits
Submission-readiness is a THIRD concern area for the skill, alongside (1) the
review / edit loop and (2) auto mode. A applies across all modes as a gate / guard;
B is a direct-edit capability. A ships as `scripts/compliance-check.js` (built); B (vision-based layout verification) is not yet built. This note is the design record.

## Changelog
- 2026-06-01 v0: A (template compliance: identify + report-link + project-owned
  constraints + deterministic / semantic checker; no bundled template, no
  auto-swap) and B (compile-driven layout: rendered-artifact visual loop,
  real-vision-not-OCR, hybrid vision + deterministic verify, lever box, local-LaTeX
  detect-or-degrade, honesty rule) recorded from discussion.
