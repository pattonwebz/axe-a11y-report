# Changelog

Notable changes to this package. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-07-24

### Added

- `buildHtmlReport(results, { title })` — a polished, self-contained HTML accessibility
  dashboard (tabs by rule/URL/group/all-violations, search and severity filters, light/system/dark
  theme, full keyboard and ARIA support) with a Personas page. Extracted from
  [axe-html-report-action](https://github.com/pattonwebz/axe-html-report-action) v0.0.1, whose
  Personas page previously used a separate generic-category persona system (blind, low-vision,
  motor, etc., matched via keyword heuristics with an optional consumer-supplied `persona-map`).
  That system is replaced here by the same named GDS persona registry `buildReport()` already
  uses, so both output formats hand a violation to a real person the same way. The `persona-map`
  override concept and generic categories are gone — there is one curated mapping, shared by
  Markdown and HTML.
- `aggregate()`, `groupForTags()`, `GROUP_ORDER`, and their `Aggregated`/`RuleGroup`/`GroupName`
  types, also exported — the rule-grouping logic `buildHtmlReport()` is built on.
- CLI: `--format=markdown|html` (inferred from `--out`'s extension when omitted) and `--title`.
  `--github-summary` is now rejected with `--format=html`, since GitHub job summaries strip
  `<style>`/`<script>` and the dashboard wouldn't render there.
- `highlight.js` added as a runtime dependency (HTML code-snippet syntax highlighting).

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
