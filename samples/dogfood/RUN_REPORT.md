# PaperJury Revision Comparison

**Input (draft):** `original_draft.pdf` (21 pp, 11 known defects)
**Process:** one AUTO-mode PaperJury review round, applied as edits
**Output:** `revised_draft.pdf` (22 pp, compiles with 0 errors, 0 warnings)

Ledger: 152 reviewer weaknesses -> 55 issues -> 26 applied / 10 queued / 19 dropped.

## Table 1 — Fixable defects F1-F6

| Problem (location) | Fix result | Human-verified |
|---|---|---|
| **F1** §8 concurrency: prose says `8`, table says `16` (self-contradiction) | Unified to `16` (prose + table) | ✅ verified, matches draft intent |
| **F2** §7.2 clerk merge threshold: prose `simThreshold=0.7` vs adjacent equation `0.8` | Unified to `0.8` (prose + equation) | ✅ verified, matches draft intent |
| **F3** §5 escalation jury: written `jurySize=10`, elsewhere `12` | Changed to `12` | ✅ verified, matches draft intent |
| **F4** §2 isolation invariant flipped ("jurors are given the cumulative ledger") | Restored to "isolated, no ledger sight" | ✅ verified, meaning consistent |
| **F5** §1 C5 term written `registrar`, called `clerk` everywhere else | Changed back to `clerk` | ✅ verified, matches draft intent |
| **F6** §4 dangling `\cite{wang2025programchair}` (key not in bib) | Deleted the citation; build is warning-free | ✅ verified, matches draft intent |

## Table 2 — Fabricated claims A1-A3 (not in the draft; unsupported assertions added in)

| Problem (location) | Fix result | Human-verified |
|---|---|---|
| **A1** abstract fabricates "94% router agreement … confirming … in practice" (no experiment) | Softened to "an illustrative target … Section 9 specifies the methodology" | ✅ verified (over-claim neutralized) |
| **A2** §4 fabricates "in our runs … order of magnitude fewer agents … strictly higher precision" (no experiment) | **Not fixed: the fabricated sentence is still in the draft** | ⚠ pending author (soften or delete) |
| **A3** §3 fabricates "reaches this fixed point within three rounds" (no data) | Softened to "in a small number of rounds" (drops "three") | ✅ verified (over-claim neutralized) |

## Table 3 — Baits B1-B2 (look like flaws, are defensible; must stay untouched)

| Problem (location) | Fix result | Human-verified |
|---|---|---|
| **B1** §4 "no per-section reviewer assignment and no per-section coverage quota" (looks like a coverage gap) | No fix needed; clause kept verbatim | ✅ verified (correctly judged defensible, no false positive) |
| **B2** §7 gate "evaluated over the same ledger state the engine's own steps write" (looks circular) | No fix needed; clause kept verbatim | ✅ verified (correctly judged defensible, no false positive) |

## Table 4 — Issue the engine itself introduced during review (not an injected defect)

| Problem (location) | Fix result | Human-verified |
|---|---|---|
| §1 C3 reworded to "two-sided escalating trial" by polish, but §5.2 title / §5.4 caption / §9 still say "five-tier" | **Not fixed: terminology inconsistency remains** | ⚠ pending author (revert to "five-tier trial") |

## Summary
- Fixable defects **F1-F6 all match the draft intent**; the output agrees with the clean version at these six sites.
- **2 items pending author:** A2 (fabricated comparison sentence still present) and the §1 C3 "five-tier" terminology inconsistency.
- A1/A3 over-claims softened; baits B1/B2 kept verbatim with zero false positives.
- Output `revised_draft.pdf` compiles to 22 pp with 0 errors, 0 warnings.
