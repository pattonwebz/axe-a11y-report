import type { AxeResults } from 'axe-core';
import { personas, ruleToPersonaKeys } from './personas';

export const IMPACT_ORDER = [ 'minor', 'moderate', 'serious', 'critical' ] as const;
export type Impact = ( typeof IMPACT_ORDER )[ number ];

export interface UrlResult {
	url: string;
	results?: AxeResults;
	error?: string;
}

export interface ReportOptions {
	/** Minimum violation impact that counts a URL as failed: critical, serious, moderate, minor, or none. Default 'serious'. */
	failOn?: string;
	/** Add a "Personas: who these findings affect" section mapping violated rules to the GOV.UK / GDS accessibility persona set. Default false. */
	showPersonas?: boolean;
}

export interface Report {
	/** GitHub-flavored Markdown — safe to write to a file, a PR comment, or $GITHUB_STEP_SUMMARY. */
	markdown: string;
	totalViolations: number;
	failedUrls: number;
}

function impactRank( impact: string | null | undefined ): number {
	return IMPACT_ORDER.indexOf( ( impact ?? 'minor' ) as Impact );
}

function escapeMd( text: string ): string {
	return text.replace( /</g, '&lt;' ).replace( />/g, '&gt;' );
}

/**
 * Accept either axe-scan-action output ({ url, results?, error? } entries)
 * or a raw array of axe result objects (e.g. from `@axe-core/cli --save`,
 * where each entry is the results object itself with a `url` property).
 */
export function normalizeResults( parsed: unknown ): UrlResult[] {
	if ( ! Array.isArray( parsed ) ) {
		throw new Error( 'Results file must contain a JSON array.' );
	}
	return parsed.map( ( entry, i ) => {
		if ( entry && typeof entry === 'object' && 'violations' in entry ) {
			const res = entry as AxeResults;
			return { url: res.url || `result ${ i + 1 }`, results: res };
		}
		if ( entry && typeof entry === 'object' && 'url' in entry ) {
			return entry as UrlResult;
		}
		throw new Error( `Unrecognized results entry at index ${ i }.` );
	} );
}

/**
 * Build a human-friendly Markdown accessibility report from axe-core results:
 * a per-URL violation table plus per-rule detail, optionally followed by a
 * persona section. Framework-agnostic — write the returned markdown wherever
 * you like (a file, $GITHUB_STEP_SUMMARY, a PR comment, stdout).
 */
export function buildReport( results: UrlResult[], options: ReportOptions = {} ): Report {
	const { failOn = 'serious', showPersonas = false } = options;
	const failThreshold = failOn === 'none' ? Infinity : impactRank( failOn );
	let totalViolations = 0;
	let failedUrls = 0;

	const lines: string[] = [ '## Accessibility scan (axe-core)', '' ];

	const tableRows: string[][] = [ [ 'URL', 'Critical', 'Serious', 'Moderate', 'Minor', 'Status' ] ];

	for ( const { url, results: res, error } of results ) {
		if ( error || ! res ) {
			tableRows.push( [ url, '—', '—', '—', '—', `⚠️ scan failed: ${ error }` ] );
			failedUrls++;
			continue;
		}

		const counts: Record<Impact, number> = { minor: 0, moderate: 0, serious: 0, critical: 0 };
		let urlFails = false;
		for ( const violation of res.violations ) {
			const nodes = violation.nodes.length;
			counts[ ( violation.impact ?? 'minor' ) as Impact ] += nodes;
			totalViolations += nodes;
			if ( impactRank( violation.impact ) >= failThreshold ) {
				urlFails = true;
			}
		}
		if ( urlFails ) {
			failedUrls++;
		}

		tableRows.push( [
			url,
			String( counts.critical ),
			String( counts.serious ),
			String( counts.moderate ),
			String( counts.minor ),
			urlFails ? '❌ fail' : '✅ pass',
		] );
	}

	lines.push( `| ${ tableRows[ 0 ].join( ' | ' ) } |` );
	lines.push( `| ${ tableRows[ 0 ].map( () => '---' ).join( ' | ' ) } |` );
	for ( const row of tableRows.slice( 1 ) ) {
		lines.push( `| ${ row.join( ' | ' ) } |` );
	}
	lines.push( '' );

	// Per-violation detail, grouped by URL, worst impact first.
	for ( const { url, results: res } of results ) {
		if ( ! res || res.violations.length === 0 ) {
			continue;
		}
		lines.push( `### ${ url }`, '' );
		const sorted = [ ...res.violations ].sort(
			( a, b ) => impactRank( b.impact ) - impactRank( a.impact )
		);
		for ( const v of sorted ) {
			const help = escapeMd( v.help );
			lines.push(
				`- **${ v.impact ?? 'minor' }** \`${ v.id }\` — ${ help } ` +
					`(${ v.nodes.length } element${ v.nodes.length === 1 ? '' : 's' }) ` +
					`[docs](${ v.helpUrl })`
			);
		}
		lines.push( '' );
	}

	if ( showPersonas ) {
		lines.push( ...buildPersonaSection( results ) );
	}

	return { markdown: lines.join( '\n' ).trimEnd() + '\n', totalViolations, failedUrls };
}

/**
 * Aggregate violations by rule across every URL, then render one card per real
 * persona: who they are, what they need, and which of *this run's* violated
 * rules actually touch that need — or an honest note when none do, since a
 * persona with no matched rule is a coverage gap, not a clean bill of health.
 */
function buildPersonaSection( results: UrlResult[] ): string[] {
	const nodesByRule = new Map<string, number>();
	for ( const { results: res } of results ) {
		for ( const violation of res?.violations ?? [] ) {
			nodesByRule.set( violation.id, ( nodesByRule.get( violation.id ) ?? 0 ) + violation.nodes.length );
		}
	}

	const lines: string[] = [
		'## Personas: who these findings affect',
		'',
		'Real people from the GOV.UK / GDS accessibility persona set, not just disability labels.',
		'',
	];

	for ( const persona of personas ) {
		const matchedRuleIds = Object.entries( ruleToPersonaKeys )
			.filter( ( [ , keys ] ) => keys.includes( persona.key ) )
			.map( ( [ ruleId ] ) => ruleId )
			.filter( ( ruleId ) => nodesByRule.has( ruleId ) );

		lines.push( `### ${ persona.userType } — ${ persona.name }`, '' );
		lines.push( `- ${ persona.identity }` );
		lines.push( `- Needs: ${ persona.needs }` );
		if ( matchedRuleIds.length > 0 ) {
			const ruleList = matchedRuleIds
				.map( ( ruleId ) => `\`${ ruleId }\` (${ nodesByRule.get( ruleId ) })` )
				.join( ', ' );
			lines.push( `- Found in this scan: ${ ruleList }` );
		} else {
			lines.push(
				"- Found in this scan: none of the rules that map to this persona's primary needs. " +
					'Automation coverage here is limited — prioritize manual testing.'
			);
		}
		lines.push( '' );
	}

	return lines;
}
