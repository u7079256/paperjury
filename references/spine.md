# The spine and the meaning audit (anti-drift core)

The spine + four-state meaning audit are the engine's drift guard. They are SHARED
by review-engine v3 and auto (AUTO_MODE_DESIGN §2, REVIEW_ENGINE_V3_DESIGN).
Enforcement differs by mode:

- **auto**: GATING. A failing audit verdict rolls back the causing edit and queues
  it. This is load-bearing (no human in the loop).
- **review**: ADVISORY. The audit reports drift to the human ("this edit
  weakened anchor A4 -- proceed?"); the human, who signs off every edit anyway, is
  the real drift guard. The spine-confirm step is OPTIONAL in review mode (offer it;
  do not force a critique request through a freeze gate).

The mechanism is borrowed from [PaperSpine](https://github.com/WUBING2023/PaperSpine)'s `logic_transfer_audit` 7-anchor test
(PaperSpine is a forward generate/rewrite tool with no adversarial loop, so it does
not need a drift guard; we take its anchoring idea and bolt it onto our loop).

## The spine = up to 7 frozen anchor sentences

The anchor TYPES are a CHECKLIST, not a quota (decided 2026-05-31). The spine is
whatever real anchor sentences exist; do NOT force-fit to 7 and NEVER invent one.

1. `abstract-motivation` -- abstract motivation sentence
2. `intro-problem` -- first Introduction problem sentence
3. `gap` -- the main gap sentence
4. `contribution` -- final Introduction contribution / roadmap sentence
5. `methods-rationale` -- first Methods rationale sentence
6. `results-headline` -- first Results headline finding
7. `discussion-answer` -- first Discussion answer sentence

Together they should form one coherent problem -> solution -> evidence ->
resolution arc.

### spine.json (the frozen artifact; lives next to the ledger)

```json
{
  "frozen_round": 0,
  "anchors": [
    { "anchor_id": "A1", "type": "abstract-motivation", "status": "frozen",
      "text": "<the exact sentence>", "passage_id": "frontmatter#p1#<hash>" },
    { "anchor_id": "A6", "type": "results-headline", "status": "not-yet-written",
      "text": null, "passage_id": null }
  ]
}
```

`status`: `frozen` (an existing anchor, frozen for the run) or `not-yet-written`
(an early-draft slot with no real sentence yet: tracked, not frozen). `anchor-diff.js`
only processes `frozen` anchors with non-null `text`.

## Spine establishment (the one up-front step)

Auto usually starts from a half-finished draft (abstract/intro exist; results/
discussion may not). Procedure (AUTO_MODE_DESIGN §4):

1. **Extract a DRAFT spine** semantically from the manuscript + discussion history
   (prompt below). Mark anchor types with no real sentence as `not-yet-written`.
2. **Present** the concrete extracted anchors to the author.
3. **Freeze** the existing anchors on accept (write `spine.json`). This is the one
   human input auto needs up front; everything after runs against this partial
   frozen spine. In auto under `/goal`, this freeze happens BEFORE the unattended
   run starts (there is no live ask headless).

**Anchors are never auto-edited.** Any fix that would touch a frozen anchor sentence
is ALWAYS queued (`reason_code: anchor-touching`), never auto-applied. So the audit's
real job is catching INDIRECT drift: a non-anchor edit (a supporting sentence, a
definition, a result) that makes a frozen anchor no longer hold.

**Filling a `not-yet-written` slot during the run**: auto may DRAFT a fill only from
material that already exists, and the draft is ALWAYS queued (never auto-frozen as an
anchor); only the author's approval on return promotes it. If the slot needs data
that does not exist yet (e.g. a results headline before the experiments are run),
queue a `needs-human-input` note, never a fabricated figure.

### Extraction agent prompt (one-time, at freeze)

> You are extracting the SPINE of a CS paper: the small set of load-bearing anchor
> sentences that carry its problem -> solution -> evidence -> resolution arc. From
> the manuscript (and any discussion history) below, identify the actual sentence
> (verbatim) for each anchor TYPE that genuinely exists. The 7 types are a checklist,
> not a quota: return only the anchors that real sentences support; mark the rest
> `not-yet-written`. NEVER invent or paraphrase a sentence that is not in the text
> (inventing a results headline before the experiments exist is fabrication). For
> each found anchor return the exact sentence and where it is.

Output schema: `{ anchors: [{ type, status: "frozen"|"not-yet-written", text|null }] }`.
`scripts/spine.js freeze` then assigns `anchor_id` and resolves `passage_id` by locating
each anchor's text via `decompose.js`, and writes `spine.json` after the author confirms.

## The four-state meaning audit (per round)

Each round, `anchor-diff.js` (deterministic) locates the frozen anchors and flags the
ones whose support region changed or that are no longer present verbatim
(`need_audit`). The semantic agent then judges ONLY those flagged anchors (never the
whole spine) against the frozen anchor + the current supporting text.

Verdict space (AUTO_MODE_DESIGN §2):

| verdict | meaning | auto action |
|---|---|---|
| `holds` | anchor still true and still supported by current text | pass |
| `weakened` | the anchor's commitment is softened (wording or support weaker) | roll back causing edit(s), queue |
| `contradicted` | current text directly conflicts with the anchor | roll back, queue |
| `now-unsupported` | anchor still stated, but the evidence that backed it was edited away | roll back, queue |

`weakened` and `now-unsupported` are kept SEPARATE (a softened claim vs a claim whose
support vanished are different failures needing different human calls). Any of the
last three rolls back the EDIT that caused it (never the anchor) and queues it with
before/after. Cumulative audit: the baseline fed to `anchor-diff.js` is the frozen
round-0 text, so small drifts that each pass a single round are caught against round-0.

### Meaning-audit agent prompt (per flagged anchor)

> You are auditing whether a FROZEN anchor sentence of a CS paper still holds after
> edits to the text around it. You are given: the frozen anchor (its exact wording is
> immutable and was NOT edited), the BASELINE supporting text (round-0), and the
> CURRENT supporting text. Decide ONE verdict: `holds` (still true and still
> supported), `weakened` (commitment softened in wording or support), `contradicted`
> (current text directly conflicts with the anchor), `now-unsupported` (anchor still
> stated but the evidence that backed it was edited away). Judge meaning, not surface
> wording; a faithful heavy rewrite still `holds`. If not `holds`, name the exact
> current text that caused it. Be precise; do not inflate a faithful edit into drift.

Output schema (the `meaning-audit.workflow.js` enforces it):
`{ anchor_id, verdict, reason, offending_text|null }`, plus a separate arc check
`{ arc_intact: bool, reason }` over the whole frozen spine.
