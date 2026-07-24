import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join( fileURLToPath( import.meta.url ), '..', '..' );
const { normalizeResults, buildReport, buildHtmlReport } = await import( join( root, 'dist', 'index.js' ) );

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

// HTML report: self-contained, all seven named GDS personas present, malicious
// input from a hostile results file stays inert (escaped), not live markup.
const htmlFixture = JSON.parse(
	readFileSync( join( root, 'tests', 'fixtures', 'html-sample-results.json' ), 'utf8' )
);
const html = buildHtmlReport( normalizeResults( htmlFixture ), { title: 'Self-test report' } );
assert.ok( html.startsWith( '<!doctype html>' ), 'HTML report starts with a doctype' );
assert.ok( html.includes( 'Self-test report' ), 'title is rendered' );
for ( const name of [ 'Ashleigh', 'Claudia', 'Christopher', 'Pawel', 'Ron', 'Saleem', 'Simone' ] ) {
	assert.ok( html.includes( name ), `${ name } appears in the Personas page` );
}

const maliciousFixture = JSON.parse(
	readFileSync( join( root, 'tests', 'fixtures', 'malicious-results.json' ), 'utf8' )
);
const maliciousHtml = buildHtmlReport( normalizeResults( maliciousFixture ) );
assert.ok(
	! /<script[^>]*>[^<]*alert/.test( maliciousHtml ),
	'a script tag from a hostile results file is not rendered live'
);
assert.ok( ! /<img[^>]+onerror=/.test( maliciousHtml ), 'an onerror attribute from a hostile results file is not rendered live' );
assert.ok( maliciousHtml.includes( '&lt;script' ) || maliciousHtml.includes( '&lt;img' ), 'the hostile input is present, escaped' );

console.log( 'HTML report: OK' );

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

	// CLI: --format=html (also exercised via --out ending in .html, the inferred path).
	const htmlOut = join( tmp, 'report.html' );
	execFileSync(
		'node',
		[
			join( root, 'dist', 'cli.js' ),
			`--results-file=${ join( root, 'tests', 'fixtures', 'html-sample-results.json' ) }`,
			'--fail-on=none',
			`--out=${ htmlOut }`,
		],
		{ stdio: 'pipe' }
	);
	const writtenHtml = readFileSync( htmlOut, 'utf8' );
	assert.ok( writtenHtml.startsWith( '<!doctype html>' ), '--out=*.html infers --format=html' );
	assert.ok( writtenHtml.includes( 'Ashleigh' ), 'CLI HTML output includes persona names' );

	let githubSummaryRejected = false;
	try {
		execFileSync(
			'node',
			[
				join( root, 'dist', 'cli.js' ),
				`--results-file=${ join( root, 'tests', 'fixtures', 'html-sample-results.json' ) }`,
				'--format=html',
				'--github-summary',
			],
			{ stdio: 'pipe' }
		);
	} catch ( err ) {
		githubSummaryRejected = true;
		assert.equal( err.status, 2, '--github-summary with --format=html is a usage error' );
	}
	assert.ok( githubSummaryRejected, '--github-summary + --format=html should be rejected' );

	console.log( 'CLI HTML: OK' );
} finally {
	rmSync( tmp, { recursive: true, force: true } );
}
