# Config template (optional, project-owned)

This skill ships NO config of its own and NO hardcoded paths. It resolves every
input at runtime (discovery, then ask) per the "Resolving inputs at runtime"
section of `SKILL.md`.

A project that wants to pin its inputs (so it does not get asked every session)
MAY drop a config like the one below in ITS OWN repo, for example at
`<project>/.paper-review/config.yaml`. The skill reads it if present and falls
back to discovery/ask for anything missing. This file is owned by the project,
not by the skill.

All values below are PLACEHOLDERS. Do not commit real paths into the skill.

```yaml
# <project>/.paper-review/config.yaml  -- example shape, fill in per project

target:
  manuscript: <path to the main .tex>      # else: auto-detect \documentclass / ask
  mode: full                                # full | passage  (mode: auto + intensity: are DESIGNED, not built — see docs/AUTO_MODE_DESIGN.md)
  passage_anchor: <section/paragraph/claim> # only when mode = passage

venue_family: <vision | nlp | ml>           # else: infer from the class/template / ask

author: <who signs off on edits>            # every edit needs explicit authorization

personas:                                   # else: the 3 default lenses in references/reviewer-personas.md
  - { id: R1, lensName: Theory / Foundations, agentType: <optional named subagent> }
  - { id: R2, lensName: Empirical / Benchmark, agentType: <optional> }
  - { id: R3, lensName: Applied / Systems,     agentType: <optional> }

style_profile: |                            # else: the venue-family default, refined from memory
  <house rules: plain prose, em-dash policy, caption convention, tense, etc.>

ledger: <path to LEDGER.md>                 # else: <manuscript-dir>/.paper-review/LEDGER.md

writing_toolkit:                            # which drafting prompts to enable (see references/writing-toolkit.md)
  enabled: [translate-to-english, polish-english, de-ai, compress, expand, caption, experiment-analysis, logic-check]
```

## Discovery defaults (when no config is present)

- manuscript: the `.tex` containing `\documentclass` / `\begin{document}`; if
  several, ask.
- venue_family: infer from the style/class file or content; if unclear, ask.
- ledger: `<manuscript-dir>/.paper-review/LEDGER.md` (create if absent).
- author: the current user (confirm before the first edit).
- personas: the three default lenses; inline their prompts unless the project
  defines named reviewer subagents to use as `agentType`.
- style_profile: the venue-family default from `references/reviewer-personas.md`,
  refined by any conventions recalled from memory.
