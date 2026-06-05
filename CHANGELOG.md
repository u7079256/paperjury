# Changelog

All notable changes to PaperJury are documented in this file.

## [0.5.0] - 2026-06-05

### Added

- **Claude Code plugin packaging.** PaperJury can now be installed as a Claude Code
  plugin from a self-hosted marketplace, alongside the existing clone-as-skill install.
  - `.claude-plugin/plugin.json` — plugin manifest. Declares the skill at the repo
    root (`"skills": ["./"]`, root-as-skill) so `SKILL.md` does not move and the
    plain-skill install keeps working.
  - `.claude-plugin/marketplace.json` — self-hosted marketplace listing this one
    plugin (`source: "./"`).
  - Install: `/plugin marketplace add u7079256/paperjury` then
    `/plugin install paperjury@u7079256`.

### Notes

- This change is additive and non-breaking: `SKILL.md` stays at the repo root and is
  still auto-discovered as a plain skill, so the existing `~/.claude/skills/paperjury`
  install (clone-as-skill) is unaffected.
- The plugin manifest version tracks the skill engine version in `SKILL.md` frontmatter.
- This is the first tracked changelog entry; it documents the packaging change shipped
  on top of the existing 0.5.0 engine, not the full engine history.
