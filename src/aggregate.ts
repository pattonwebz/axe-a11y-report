import { IMPACT_ORDER, Impact, UrlResult, impactRank } from './report';

export type ImpactKey = Impact | 'none';

/** Normalize a raw impact string to a counting key: unknown/absent → 'none'. */
export function impactKey( impact: string | null | undefined ): ImpactKey {
	return IMPACT_ORDER.includes( ( impact ?? '' ) as Impact ) ? ( impact as Impact ) : 'none';
}

/** The slice of an axe-core node result the HTML report renders. */
export interface AxeNodeResult {
	html?: string;
	target?: unknown[];
	failureSummary?: string;
}

/** One rule aggregated across every URL it fired on. */
export interface RuleGroup {
	id: string;
	impact: string | null;
	tags: string[];
	description: string;
	help: string;
	helpUrl: string;
	nodeCount: number;
	perUrl: { url: string; nodes: AxeNodeResult[] }[];
}

export interface Aggregated {
	byRule: RuleGroup[];
	counts: Record<ImpactKey, number>;
	totalViolations: number;
	scannedUrls: number;
	erroredUrls: number;
	engine: string;
	timestamp: string;
}

/** Group violations by rule id across URLs and total the per-impact counts. */
export function aggregate( results: UrlResult[] ): Aggregated {
	const byRule = new Map<string, RuleGroup>();
	const counts: Record<ImpactKey, number> = { critical: 0, serious: 0, moderate: 0, minor: 0, none: 0 };
	let totalViolations = 0;
	let scannedUrls = 0;
	let erroredUrls = 0;
	let engine = '';
	let timestamp = '';

	for ( const { url, results: res, error } of results ) {
		if ( error || ! res ) {
			erroredUrls++;
			continue;
		}
		scannedUrls++;
		if ( ! engine && res.testEngine?.name ) {
			engine = `${ res.testEngine.name } ${ res.testEngine.version ?? '' }`.trim();
		}
		if ( ! timestamp && res.timestamp ) {
			timestamp = res.timestamp;
		}
		for ( const v of res.violations ) {
			counts[ impactKey( v.impact ) ] += v.nodes.length;
			totalViolations += v.nodes.length;
			let group = byRule.get( v.id );
			if ( ! group ) {
				group = {
					id: v.id,
					impact: v.impact ?? null,
					tags: v.tags ?? [],
					description: v.description ?? '',
					help: v.help ?? '',
					helpUrl: v.helpUrl ?? '',
					nodeCount: 0,
					perUrl: [],
				};
				byRule.set( v.id, group );
			}
			group.nodeCount += v.nodes.length;
			group.perUrl.push( { url, nodes: v.nodes as AxeNodeResult[] } );
		}
	}

	const sorted = [ ...byRule.values() ].sort(
		( a, b ) => impactRank( b.impact ) - impactRank( a.impact ) || b.nodeCount - a.nodeCount
	);

	return { byRule: sorted, counts, totalViolations, scannedUrls, erroredUrls, engine, timestamp };
}

export type GroupName = 'WCAG A' | 'WCAG AA' | 'Best practice' | 'Other / custom';
export const GROUP_ORDER: GroupName[] = [ 'WCAG A', 'WCAG AA', 'Best practice', 'Other / custom' ];

/** Bucket a rule by its axe tags: WCAG level A beats AA; best-practice next; everything else is custom. */
export function groupForTags( tags: string[] ): GroupName {
	if ( tags.some( ( t ) => /^wcag2\d*a$/.test( t ) ) ) {
		return 'WCAG A';
	}
	if ( tags.some( ( t ) => /^wcag2\d*aa$/.test( t ) ) ) {
		return 'WCAG AA';
	}
	if ( tags.includes( 'best-practice' ) ) {
		return 'Best practice';
	}
	return 'Other / custom';
}
