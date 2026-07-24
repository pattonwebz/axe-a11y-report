# @pattonwebz/axe-a11y-report

Turns raw [axe-core](https://github.com/dequelabs/axe-core) JSON results into an accessibility
report — as **Markdown** (a per-URL violation table plus per-rule detail, e.g. for a GitHub job
summary) or as a **polished, self-contained HTML dashboard** (tabs, search, filters, a Personas
page — the thing you'd actually hand to a non-technical stakeholder). Both formats share an
optional section mapping findings to the real [GOV.UK / GDS accessibility
personas](https://alphagov.github.io/accessibility-personas/) (Ashleigh, Claudia, Christopher,
Pawel, Ron, Saleem, Simone) instead of leaving them as an abstract disability category.

Framework-agnostic: no GitHub Actions dependency. Use it as a library, as a CLI, in any CI
system, or straight from your own scripts.

This is the library behind two GitHub Actions:

- [axe-report-action](https://github.com/pattonwebz/axe-report-action) — Markdown in the job summary, with pass/fail thresholds.
- [axe-html-report-action](https://github.com/pattonwebz/axe-html-report-action) — the HTML dashboard, written to a file for `actions/upload-artifact`.

Both are thin wrappers around this package. Use the package directly when you want the same
report somewhere else: locally, in another CI system, in a PR-comment bot, wherever.

## Install

```bash
npm install @pattonwebz/axe-a11y-report
```

## CLI

Markdown (default):

```bash
npx @pattonwebz/axe-a11y-report \
  --results-file=axe-results.json \
  --fail-on=serious \
  --show-personas \
  --out=report.md
```

HTML (self-contained, works from `file://`, no network access needed):

```bash
npx @pattonwebz/axe-a11y-report \
  --results-file=axe-results.json \
  --format=html \
  --title="Accessibility report" \
  --out=report.html
```

`--format` is inferred from `--out`'s extension when omitted, so the second example also works
without `--format=html`.

| Flag | Default | Description |
|---|---|---|
| `--results-file` | *(required)* | Path to a JSON file: axe-scan-action output, or a raw array of axe result objects (e.g. `@axe-core/cli --save`). |
| `--format` | inferred | `markdown` or `html`. Inferred from `--out`'s extension (`.html` → html) when not set, else `markdown`. |
| `--fail-on` | `serious` | `critical`, `serious`, `moderate`, `minor`, or `none`. |
| `--show-personas` | off | Markdown only — add the "who these findings affect" persona section. The HTML report always includes its Personas page. |
| `--out` | stdout | Write the report to a file instead of stdout. |
| `--title` | `Accessibility report` | HTML only — report title shown in the page header and browser tab. |
| `--github-summary` | off | Markdown only — also append the report to `$GITHUB_STEP_SUMMARY`, if set. Rejected with `--format=html`: job summaries strip `<style>`/`<script>`, so the dashboard wouldn't render — write it to a file and upload it as a workflow artifact instead. |

Exit code is `1` when any URL is at/above the `--fail-on` threshold (or unscannable), `0`
otherwise — same semantics as `fail-on: none` always passing, regardless of format.

## Library

```ts
import { normalizeResults, buildReport, buildHtmlReport } from '@pattonwebz/axe-a11y-report';
import { readFileSync } from 'node:fs';

const results = normalizeResults( JSON.parse( readFileSync( 'axe-results.json', 'utf8' ) ) );

const report = buildReport( results, { failOn: 'serious', showPersonas: true } );
console.log( report.markdown );        // Markdown string — write it wherever you like
console.log( report.totalViolations ); // number
console.log( report.failedUrls );      // number

const html = buildHtmlReport( results, { title: 'Accessibility report' } ); // HTML string
```

`personas`, `personasForRule`, and `ruleToPersonaKeys` are also exported, if you want the raw
persona data for something other than the built-in report sections. `aggregate()` (from the same
package) is what `buildHtmlReport()` uses internally to group violations by rule, if you want to
build your own view on top of it.

## The HTML report

A dark glassmorphic dashboard with a sticky sidebar (search, per-impact summary tiles, active-filter
bar) beside four tabbed views: violations **by rule** (accordions with per-element selectors and
failure summaries), **by URL** (including scan errors and clean pages), **by group** (WCAG A,
WCAG AA, Best practice, Other), and **all violations** — a flat severity-sorted feed. A second page,
**Personas**, shows one card per named GDS persona: who they are, what they need, and which of this
run's rules affect them — plus an honest "not yet mapped" card for rules outside the curated set.

Everything is filterable (search with debounce, multi-select severity toggles, removable filter
chips) and built to be accessible itself: proper tab/accordion ARIA patterns, full keyboard
operability, visible focus rings, labels never carried by color alone, `prefers-reduced-motion`
respected, and a light/system/dark theme toggle that persists via `localStorage`. Every value from
the results file is HTML-escaped before rendering — a hostile results file cannot inject markup.

## Running locally against a real site, for free

No GitHub Actions runtime needed — this is a plain Node package. Point it at any axe-core
results file, from any source:

```bash
npx @axe-core/cli https://your-local-site/ --save axe-results.json
npx @pattonwebz/axe-a11y-report --results-file=axe-results.json --show-personas --out=report.md
npx @pattonwebz/axe-a11y-report --results-file=axe-results.json --out=report.html
```

## Development

```bash
npm install
npm run typecheck
npm run build          # compiles src/ to dist/ (gitignored — built at publish/install time)
node tests/self-test.mjs
```

`dist/` is not committed. `npm install` (including as a git dependency) runs the `prepare`
script automatically, which builds it.
