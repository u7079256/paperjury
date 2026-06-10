# Changelog

All notable changes to PaperJury are documented in this file.

## [1.0.0] - 2026-06-10

First stable release, aligned with the Codex port's v1.0.

### Added

- **Soft update reminders.** `scripts/check-update.js` soft-checks stable GitHub
  release tags at PaperJury startup and prints a non-blocking update notice
  (plugin and clone routes). Silent when GitHub is unreachable; disable with
  `PAPERJURY_DISABLE_UPDATE_CHECK=1`.

### Changed

- **Dogfood sample PDFs restored to the repo.** `original_draft.pdf` and
  `revised_draft.pdf` live in `samples/dogfood/` again, so the public repo is
  self-contained; they are no longer distributed as release assets.
- **Version promoted to 1.0.0** across the plugin manifest, marketplace listing,
  package manifest, and `SKILL.md` frontmatter. The `v0.5.0` release and tag are
  superseded by `v1.0.0`.

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
