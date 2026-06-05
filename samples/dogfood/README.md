# Dogfood Sample

This folder contains a complete PaperJury dogfood run:

- `original_draft.pdf`: input draft with known injected defects.
- `revised_draft.pdf`: output after one AUTO-mode PaperJury review round.
- `RUN_REPORT.md`: English human-verified comparison report.
- `RUN_REPORT.zh-CN.md`: Chinese human-verified comparison report.

The PDFs are committed directly because they are small enough for ordinary Git
history and useful for visual inspection. The source `.tex` is intentionally not
included; this sample is meant to show the before/after artifact and the run
report, not to serve as a build fixture.

