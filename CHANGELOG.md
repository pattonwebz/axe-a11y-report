# Changelog

Notable changes to this package. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-07-24

Initial release. Extracted from [axe-report-action](https://github.com/pattonwebz/axe-report-action)
v0.0.3's report-generation logic, made framework-agnostic (no `@actions/core` dependency —
`buildReport()` returns a Markdown string instead of writing to a GitHub Actions job summary
directly), and given a CLI so it can be installed and run anywhere, not just from within a
GitHub Action.

- `normalizeResults(parsed)` — accepts axe-scan-action output or a raw array of axe result objects.
- `buildReport(results, { failOn, showPersonas })` — per-URL violation table, per-rule detail,
  and an optional persona section mapping findings to the real GOV.UK / GDS accessibility
  personas (Ashleigh, Claudia, Christopher, Pawel, Ron, Saleem, Simone).
- `axe-a11y-report` CLI (`--results-file`, `--fail-on`, `--show-personas`, `--out`, `--github-summary`).
