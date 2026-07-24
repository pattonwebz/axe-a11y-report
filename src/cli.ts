#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { buildReport, normalizeResults, IMPACT_ORDER } from './report';

function parseArgs( argv: string[] ): Record<string, string | boolean> {
	const args: Record<string, string | boolean> = {};
	for ( const arg of argv ) {
		const match = /^--([^=]+)(?:=(.*))?$/.exec( arg );
		if ( match ) {
			args[ match[ 1 ] ] = match[ 2 ] ?? true;
		}
	}
	return args;
}

function usage(): string {
	return (
		'Usage: axe-a11y-report --results-file=<path> [--fail-on=serious] [--show-personas] ' +
		'[--out=<path>] [--github-summary]\n\n' +
		'  --results-file    Path to a JSON file: axe-scan-action output, or a raw array of axe result objects.\n' +
		'  --fail-on         critical, serious, moderate, minor, or none. Default: serious.\n' +
		'  --show-personas   Add the "who these findings affect" persona section.\n' +
		'  --out             Write the Markdown report to this file instead of stdout.\n' +
		'  --github-summary  Also append the report to $GITHUB_STEP_SUMMARY, if set.\n'
	);
}

function main(): void {
	const args = parseArgs( process.argv.slice( 2 ) );

	const resultsFile = args[ 'results-file' ];
	if ( typeof resultsFile !== 'string' ) {
		process.stderr.write( usage() );
		process.exit( 2 );
	}

	const failOn = typeof args[ 'fail-on' ] === 'string' ? ( args[ 'fail-on' ] as string ) : 'serious';
	if ( failOn !== 'none' && ! IMPACT_ORDER.includes( failOn as never ) ) {
		process.stderr.write( `Invalid --fail-on value "${ failOn }". Use one of: ${ IMPACT_ORDER.join( ', ' ) }, none.\n` );
		process.exit( 2 );
	}

	const showPersonas = Boolean( args[ 'show-personas' ] );

	const results = normalizeResults( JSON.parse( readFileSync( resultsFile, 'utf8' ) ) );
	const report = buildReport( results, { failOn, showPersonas } );

	const out = args.out;
	if ( typeof out === 'string' ) {
		writeFileSync( out, report.markdown );
	} else {
		process.stdout.write( report.markdown );
	}

	if ( args[ 'github-summary' ] && process.env.GITHUB_STEP_SUMMARY ) {
		appendFileSync( process.env.GITHUB_STEP_SUMMARY, report.markdown );
	}

	process.stderr.write(
		`\n${ report.totalViolations } violation(s), ${ report.failedUrls } of ${ results.length } URL(s) failed ` +
			`(fail-on: ${ failOn }).\n`
	);

	if ( failOn !== 'none' && report.failedUrls > 0 ) {
		process.exitCode = 1;
	}
}

main();
