# @pattonwebz/axe-a11y-report

Turns raw [axe-core](https://github.com/dequelabs/axe-core) JSON results into a Markdown
accessibility report — a per-URL violation table plus per-rule detail — with an optional
section mapping findings to the real [GOV.UK / GDS accessibility
personas](https://alphagov.github.io/accessibility-personas/) (Ashleigh, Claudia, Christopher,
Pawel, Ron, Saleem, Simone) instead of leaving them as an abstract disability category.

Framework-agnostic: no GitHub Actions dependency. Use it as a library, as a CLI, in any CI
system, or straight from your own scripts.

This is the library behind [axe-report-action](https://github.com/pattonwebz/axe-report-action)
— the action is a thin wrapper that calls this package and writes the result to a GitHub Actions
job summary. Use this package directly when you want the same report somewhere else: locally,
in another CI system, in a PR-comment bot, wherever.

## Install

```bash
npm install @pattonwebz/axe-a11y-report
```

## CLI

```bash
npx @pattonwebz/axe-a11y-report \
  --results-file=axe-results.json \
  --fail-on=serious \
  --show-personas \
  --out=report.md
```

| Flag | Default | Description |
|---|---|---|
| `--results-file` | *(required)* | Path to a JSON file: axe-scan-action output, or a raw array of axe result objects (e.g. `@axe-core/cli --save`). |
| `--fail-on` | `serious` | `critical`, `serious`, `moderate`, `minor`, or `none`. |
| `--show-personas` | off | Add the "who these findings affect" persona section. |
| `--out` | stdout | Write the Markdown report to a file instead of stdout. |
| `--github-summary` | off | Also append the report to `$GITHUB_STEP_SUMMARY`, if set — lets you use this CLI directly in a GitHub Actions step without the wrapper action. |

Exit code is `1` when any URL is at/above the `--fail-on` threshold (or unscannable), `0`
otherwise — same semantics as `fail-on: none` always passing.

## Library

```ts
import { normalizeResults, buildReport } from '@pattonwebz/axe-a11y-report';
import { readFileSync } from 'node:fs';

const results = normalizeResults( JSON.parse( readFileSync( 'axe-results.json', 'utf8' ) ) );
const report = buildReport( results, { failOn: 'serious', showPersonas: true } );

console.log( report.markdown );        // Markdown string — write it wherever you like
console.log( report.totalViolations ); // number
console.log( report.failedUrls );      // number
```

`personas`, `personasForRule`, and `ruleToPersonaKeys` are also exported, if you want the raw
persona data for something other than the built-in Markdown section.

## Running locally against a real site, for free

No GitHub Actions runtime needed — this is a plain Node package. Point it at any axe-core
results file, from any source:

```bash
npx @axe-core/cli https://your-local-site/ --save axe-results.json
npx @pattonwebz/axe-a11y-report --results-file=axe-results.json --show-personas --out=report.md
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
