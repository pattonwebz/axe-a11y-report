#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { buildReport, normalizeResults, IMPACT_ORDER } from './report';
import { buildHtmlReport } from './html';

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
		'Usage: axe-a11y-report --results-file=<path> [--format=markdown|html] [--fail-on=serious] ' +
		'[--show-personas] [--out=<path>] [--title=<title>] [--github-summary]\n\n' +
		'  --results-file    Path to a JSON file: axe-scan-action output, or a raw array of axe result objects.\n' +
		'  --format          "markdown" or "html". Default: inferred from --out\'s extension, else "markdown".\n' +
		'  --fail-on         critical, serious, moderate, minor, or none. Default: serious.\n' +
		'  --show-personas   Markdown only — add the "who these findings affect" persona section (the HTML\n' +
		'                    report always includes its Personas page).\n' +
		'  --out             Write the report to this file instead of stdout.\n' +
		'  --title           HTML only — report title shown in the page header and browser tab.\n' +
		'  --github-summary  Markdown only — also append the report to $GITHUB_STEP_SUMMARY, if set.\n'
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

	const out = args.out;
	const format = typeof args.format === 'string'
		? args.format
		: typeof out === 'string' && out.endsWith( '.html' )
			? 'html'
			: 'markdown';
	if ( format !== 'markdown' && format !== 'html' ) {
		process.stderr.write( `Invalid --format value "${ format }". Use "markdown" or "html".\n` );
		process.exit( 2 );
	}

	if ( format === 'html' && args[ 'github-summary' ] ) {
		process.stderr.write(
			'--github-summary only applies to --format=markdown — GitHub job summaries strip <style>/<script>. ' +
				'Write the HTML report to a file and upload it as a workflow artifact instead.\n'
		);
		process.exit( 2 );
	}

	const showPersonas = Boolean( args[ 'show-personas' ] );
	const results = normalizeResults( JSON.parse( readFileSync( resultsFile, 'utf8' ) ) );
	const summary = buildReport( results, { failOn, showPersonas } );

	if ( format === 'html' ) {
		const title = typeof args.title === 'string' ? args.title : undefined;
		const html = buildHtmlReport( results, title ? { title } : {} );
		if ( typeof out === 'string' ) {
			writeFileSync( out, html );
		} else {
			process.stdout.write( html );
		}
	} else {
		if ( typeof out === 'string' ) {
			writeFileSync( out, summary.markdown );
		} else {
			process.stdout.write( summary.markdown );
		}
		if ( args[ 'github-summary' ] && process.env.GITHUB_STEP_SUMMARY ) {
			appendFileSync( process.env.GITHUB_STEP_SUMMARY, summary.markdown );
		}
	}

	process.stderr.write(
		`\n${ format } report ${ typeof out === 'string' ? `written to ${ out }` : 'written to stdout' } — ` +
			`${ summary.totalViolations } violation(s), ${ summary.failedUrls } of ${ results.length } URL(s) failed ` +
			`(fail-on: ${ failOn }).\n`
	);

	if ( failOn !== 'none' && summary.failedUrls > 0 ) {
		process.exitCode = 1;
	}
}

main();
