import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join( fileURLToPath( import.meta.url ), '..', '..' );
const { normalizeResults, buildReport } = await import( join( root, 'dist', 'index.js' ) );

const fixture = JSON.parse( readFileSync( join( root, 'tests', 'fixtures', 'scan-results.json' ), 'utf8' ) );
const results = normalizeResults( fixture );

// Library API: matches the numbers axe-report-action's own self-test has always asserted.
const serious = buildReport( results, { failOn: 'serious' } );
assert.equal( serious.totalViolations, 6, 'serious: totalViolations' );
assert.equal( serious.failedUrls, 2, 'serious: failedUrls' );
assert.ok( ! serious.markdown.includes( 'Personas' ), 'showPersonas defaults to false' );

const none = buildReport( results, { failOn: 'none' } );
assert.equal( none.totalViolations, 6, 'none: totalViolations' );
assert.equal( none.failedUrls, 1, 'none: failedUrls (unreachable URL still counts)' );

const withPersonas = buildReport( results, { failOn: 'serious', showPersonas: true } );
assert.ok( withPersonas.markdown.includes( 'Personas: who these findings affect' ), 'showPersonas: true adds the section' );
assert.ok( withPersonas.markdown.includes( 'Ashleigh' ), 'persona names are rendered' );

// This fixture's rules (image-alt, html-has-lang, region) happen to touch every persona at
// least once — test the coverage-gap wording on a synthetic case where one rule doesn't.
const gapCase = buildReport(
	[ { url: 'https://example.test/', results: { violations: [ { id: 'color-contrast', impact: 'serious', help: 'x', helpUrl: 'x', description: 'x', nodes: [ {} ] } ], passes: [], inapplicable: [], incomplete: [], testEngine: {}, testRunner: {}, testEnvironment: {}, timestamp: '', url: '', toolOptions: {} } } ],
	{ showPersonas: true }
);
assert.ok(
	gapCase.markdown.includes( 'Automation coverage here is limited' ),
	'a persona with zero matched rules is reported as a coverage gap'
);

console.log( 'Library API: OK' );

// CLI: same fixture, --out writes a file, exit code reflects fail-on.
const tmp = mkdtempSync( join( tmpdir(), 'axe-a11y-report-self-test-' ) );
const outFile = join( tmp, 'report.md' );
try {
	let threw = false;
	try {
		execFileSync(
			'node',
			[
				join( root, 'dist', 'cli.js' ),
				`--results-file=${ join( root, 'tests', 'fixtures', 'scan-results.json' ) }`,
				'--fail-on=serious',
				'--show-personas',
				`--out=${ outFile }`,
			],
			{ stdio: 'pipe' }
		);
	} catch ( err ) {
		threw = true;
		assert.equal( err.status, 1, 'CLI exits 1 when fail-on threshold is exceeded' );
	}
	assert.ok( threw, 'CLI should exit non-zero for this fixture at fail-on: serious' );

	const written = readFileSync( outFile, 'utf8' );
	assert.ok( written.includes( 'Personas: who these findings affect' ), 'CLI --out file includes personas' );

	execFileSync(
		'node',
		[
			join( root, 'dist', 'cli.js' ),
			`--results-file=${ join( root, 'tests', 'fixtures', 'scan-results.json' ) }`,
			'--fail-on=none',
			`--out=${ outFile }`,
		],
		{ stdio: 'pipe' }
	);
	console.log( 'CLI: OK' );
} finally {
	rmSync( tmp, { recursive: true, force: true } );
}
