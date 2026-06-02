# Writing toolkit (the edit-drafting layer)

This is the optional drafting layer the loop uses at step 9 (authorize + draft).
When an issue reaches `agreed-to-fix`, the patch that satisfies its
`close_criterion` is drafted through the matching prompt below rather than
free-handed. It is a polish/translate/structure layer; it does NOT review (the
panel owns that) and it does NOT draft from scratch (use `ml-paper-writing`).

Scope of the toolkit: these are the skill's own single-passage, LaTeX-safe writing
operations for the edit-drafting step. The toolkit deliberately excludes
whole-paper "reviewer-perspective" critique (the panel owns that and is stronger),
Word-only and reading-only translation, and figure-image generation (see
`academic-plotting`); those are out of scope for editing one English LaTeX passage.

## Common guards (apply to every prompt here)

1. **Author-side only.** Any back-translation, modification log, or self-check
   verdict a prompt emits is an author aid. It goes to author notes, NEVER into
   the manuscript or a frozen snapshot (no `% changelog` comments, no inline
   notes). The patch content is the target-language text only.
2. **Bind to the close_criterion.** Polish toward that one concrete sentence. Do
   not reinterpret or expand scope to a passage another open issue wants changed.
3. **Plain CS-conference prose.** No em-dashes (use commas, colons, or separate
   sentences). No gratuitous bold/italic in body text. Preserve a conventional
   bold caption run-in lead where the venue uses one (do not mistake it for an AI
   tell). Keep lists out of running prose unless the structure is genuinely
   required.
4. **LaTeX-safe.** Preserve `cite`/`ref`/`label`/`eg`/`ie` commands and math
   (`$...$`); escape special chars (`%`, `_`, `&`). Never delete a semantically
   required environment.
5. **No fabrication.** Especially for expand and experiment-analysis: surface
   only what the source/data supports; invent no numbers, no results, no claims.

`{venue}` below is set from the config (e.g. CVPR, ACL, ICLR/NeurIPS).

## The prompts

### translate-to-english (zh -> en LaTeX) [highest value for an L2 author]
Turn the author's Chinese intent or Chinese draft of a passage into a clean
English LaTeX fragment that satisfies the close_criterion. Present tense for
method/architecture/results. Before returning, scan the output and confirm no
untranslated Chinese characters remain (author-side check). Output: English LaTeX
only (keep any back-translation author-side). Use for: "translate the author's intent for X into English LaTeX",
"replace the translationese passage in X with idiomatic prose".

### polish-english
Sentence-level rewrite of an existing English LaTeX passage to {venue} language
quality: zero grammar/spelling errors, formal register, no contractions, avoid
possessive apostrophe-s on method/model names (use "the performance of METHOD").
Keep cite/ref; add no new emphasis. Do not expand acronyms (keep "LLM" as-is, not
"Large Language Models"); prefer common, precise words over obscure ones. Use for:
"rewrite X for clarity", "polish X to venue standard".

### de-ai
Rewrite an English LaTeX passage to read as a human {venue} researcher: drop
overused AI tells and inflated rhetoric, prefer plain precise words, and keep the
original if it is already natural (do not churn). Use for: "make X read human /
de-AI", "remove em-dashes and inflated rhetoric from X".

Tells to scan for (replace only when it improves the sentence): leverage, delve,
utilize, showcase, underscore, intricate, pivotal, seamless, holistic, nuanced,
realm, tapestry, testament, landscape, "it is worth noting that", "plays a crucial
role", "in order to", rule-of-three triplets, mechanical connective stacks
(firstly / moreover / furthermore), em-dash abuse, empty -ing wind-ups, vague
attribution ("studies show"), and negative-parallelism overuse ("not only ... but
also").

For a draft translated from Chinese (L2 author), also flag translationese: stacked
attributive chains ("the ... of the ... of the ..."), gratuitous passive voice,
and hollow-rhetoric vocabulary (paradigm shift, disruptive, profound, in essence).

### compress
Reduce an English LaTeX passage by a small amount (roughly 5-15 words) via
syntactic compression without dropping any claim, citation, or parameter. Do not
over-compress: never collapse a paragraph into a single sentence, and if a
parameter or qualifier got removed, put it back. Common moves: clause to phrase,
passive to active, drop fillers ("in order to" -> "to"). Use for: "tighten the
verbose passage X". (Most CS venues have a page limit, so this is genuinely useful here.)

### expand
Surface an implicit conclusion or logical step that is missing from an English
passage (the consequence obvious in the author's source language but dropped in
English), adding only a little (roughly 5-15 words). No fabrication and no padding:
do not add filler adjectives or restate what is already on the page. Before
expanding, check the ledger: if another open issue wants this same passage tightened
or shortened, do not expand it. Use for: "make the implicit consequence of X
explicit", "state the so-what the result currently implies".

### caption (figure and table)
Write or rewrite a `\caption{}` body to {venue} standard, self-contained (define
panels, symbols, what is compared, on which dataset, by which metric). Mirror the
paper's existing caption house style (feed it 2-3 real captions as exemplars);
for vision venues keep the bold run-in lead, and keep bold panel labels for
FIGURES only (not tables). Casing: a noun-phrase caption or label uses Title Case
with no terminal period; a full-sentence caption uses Sentence case with a terminal
period (proper nouns excepted). Standard table openers: "Comparison with ...",
"Ablation study on ...", "Results on ...". Output the caption body only, with no
"Figure N:" / "Table N:" prefix (LaTeX auto-numbers). Derive from the actual
figure/table content so it stays faithful.

### experiment-analysis
Turn experiment data into a data-faithful {venue} results paragraph: comparison
and trend, not a number dump (SOTA margin, sensitivity, efficiency/accuracy
trade-off, ablation takeaway). If the data shows no clear advantage or trend, state
that plainly rather than forcing a significant-improvement summary. Render any
forced heading as a `\paragraph{}` run-in, not inline bold. No fabrication. Output:
LaTeX (keep back-translation author-side).

### logic-check (post-edit self-gate, not a reviewer)
Run AFTER a patch lands, on ONLY the edited passage: check for a logic
contradiction, an undeclared terminology switch, or severe Chinglish introduced
by the edit. Assume the patch is already high quality and report ONLY a
show-stopper; do not raise style or word-choice nits, and if there is none, emit
the pass marker. Output a pass marker or brief author-side notes; emits no prose
into the manuscript. This formalizes step 9's "verify the close_criterion" check; it
is a narrow self-gate, never a stand-in for the panel.

## Wiring into the loop

At step 9, per `agreed-to-fix` issue: pick the prompt matching the close_criterion
type, draft the patch, run logic-check on the result, write only the patch into
the manuscript, and keep all aids author-side. Then verify the criterion and mark
`closed`.
