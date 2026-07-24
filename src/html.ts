import {
	Aggregated,
	AxeNodeResult,
	GROUP_ORDER,
	GroupName,
	ImpactKey,
	RuleGroup,
	aggregate,
	groupForTags,
	impactKey,
} from './aggregate';
import { UrlResult, impactRank } from './report';
import { personas as GDS_PERSONAS, personasForRule as gdsPersonasForRule } from './personas';
import hljs from 'highlight.js/lib/core';
import xml from 'highlight.js/lib/languages/xml';

hljs.registerLanguage( 'xml', xml );

/** Escape a value for interpolation into HTML text or attribute context. */
export function esc( value: unknown ): string {
	return String( value ?? '' )
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' )
		.replace( /'/g, '&#39;' );
}

/** Return an escaped href only for http/https URLs; anything else gets no link. */
export function safeHref( url: string | undefined ): string | null {
	if ( ! url ) {
		return null;
	}
	try {
		const parsed = new URL( url );
		if ( parsed.protocol === 'http:' || parsed.protocol === 'https:' ) {
			return esc( url );
		}
	} catch {
		// fall through — not a URL at all
	}
	return null;
}

const IMPACT_LABELS: Record<ImpactKey, string> = {
	critical: 'Critical',
	serious: 'Serious',
	moderate: 'Moderate',
	minor: 'Minor',
	none: 'No impact',
};

function badge( impact: string | null | undefined ): string {
	const key = impactKey( impact );
	return `<span class="badge badge-${ key }"><span class="dot" aria-hidden="true"></span>${ IMPACT_LABELS[ key ] }</span>`;
}

function plural( n: number, word: string ): string {
	return `${ n } ${ word }${ n === 1 ? '' : 's' }`;
}

/** Persona chips inside a rule section: who this violation affects, by name. */
function renderPersonas( rule: RuleGroup ): string {
	const matched = gdsPersonasForRule( rule.id );
	if ( matched.length === 0 ) {
		return '';
	}
	const chips = matched.map( ( p ) => `<span class="persona-chip">${ esc( p.name ) }</span>` );
	return `<p class="personas"><span class="personas-label">Affects:</span> ${ chips.join( ' ' ) }</p>`;
}

/**
 * Build-time HTML syntax highlighting for code snippets via highlight.js
 * (core + xml grammar only). hljs escapes the source itself; output is
 * spans with hljs-* classes styled by the report stylesheet.
 */
export function highlightHtml( src: string ): string {
	try {
		return hljs.highlight( src, { language: 'xml' } ).value;
	} catch {
		return esc( src );
	}
}

function nodeList( nodes: AxeNodeResult[] ): string {
	// When every element failed the same way, say it once after the list
	// instead of repeating the identical fix advice per element.
	const summaries = new Set( nodes.map( ( n ) => n.failureSummary ?? '' ) );
	const shared = summaries.size === 1 ? [ ...summaries ][ 0 ] : null;
	const items = nodes.map( ( node ) => {
		const target = Array.isArray( node.target ) ? node.target.map( ( t ) => String( t ) ).join( ' ' ) : '';
		const snippet = ( node.html ?? '' ).length > 300 ? `${ node.html!.slice( 0, 300 ) }…` : node.html ?? '';
		return `<li>
			${ target ? `<code class="target">${ esc( target ) }</code>` : '' }
			${ snippet ? `<code class="snippet">${ highlightHtml( snippet ) }</code>` : '' }
			${ shared === null && node.failureSummary ? `<pre class="failure">${ esc( node.failureSummary ) }</pre>` : '' }
		</li>`;
	} );
	const sharedBlock = shared ? `<pre class="failure">${ esc( shared ) }</pre>` : '';
	return `<ul class="nodes">${ items.join( '' ) }</ul>${ sharedBlock }`;
}

function ruleDocsLink( rule: RuleGroup ): string {
	const href = safeHref( rule.helpUrl );
	if ( href ) {
		return `<a href="${ href }" rel="noopener">Documentation for ${ esc( rule.id ) }</a>`;
	}
	return rule.helpUrl ? `<span class="muted">${ esc( rule.helpUrl ) }</span>` : '';
}

/** Lowercased haystack the client-side search matches against. */
function searchText( ...parts: ( string | null | undefined )[] ): string {
	return esc( parts.filter( Boolean ).join( ' ' ).toLowerCase() );
}

let accordionSeq = 0;

/**
 * ARIA APG accordion: a heading wrapping a toggle button with
 * aria-expanded/aria-controls, pointing at a labelled region.
 */
function accordion( rule: RuleGroup, headingLevel: number, summaryHtml: string, bodyHtml: string ): string {
	const id = `acc-${ ++accordionSeq }`;
	return `<div class="rule" data-rule-id="${ esc( rule.id ) }" data-search="${ searchText( rule.id, rule.help, rule.description ) }" data-impacts="${ impactKey( rule.impact ) }">
		<h${ headingLevel } class="rule-heading">
			<button type="button" class="rule-toggle" id="${ id }-toggle" aria-expanded="false" aria-controls="${ id }-body">
				<span class="disclosure" aria-hidden="true">▸</span>
				${ summaryHtml }
			</button>
		</h${ headingLevel }>
		<div class="rule-body" id="${ id }-body" role="region" aria-labelledby="${ id }-toggle" hidden>
			${ bodyHtml }
		</div>
	</div>`;
}

function ruleSummary( rule: RuleGroup ): string {
	return `${ badge( rule.impact ) } <code>${ esc( rule.id ) }</code>
		<span class="rule-help">${ esc( rule.help ) }</span>
		<span class="counts">${ plural( rule.nodeCount, 'element' ) } · ${ plural( rule.perUrl.length, 'URL' ) }</span>`;
}

/**
 * Full body for one rule's accordion: description, docs link, affected
 * personas, and the per-URL/per-element breakdown (target, HTML snippet,
 * failure summary). Shared by every tab that lists rules in detail — a
 * rule shouldn't get a thinner writeup just because it's grouped
 * differently (the "By group" tab was previously missing all of this).
 */
function ruleDetailsBody( rule: RuleGroup ): string {
	const urls = rule.perUrl.map(
		( { url, nodes } ) => `<div class="rule-url">
			<h4>${ esc( url ) } <span class="muted">(${ plural( nodes.length, 'element' ) })</span></h4>
			${ nodeList( nodes ) }
		</div>`
	);
	return `
			${ rule.description ? `<p>${ esc( rule.description ) }</p>` : '' }
			${ ruleDocsLink( rule ) }
			${ renderPersonas( rule ) }
			${ urls.join( '' ) }`;
}

function renderRuleDetails( rule: RuleGroup ): string {
	return accordion( rule, 3, ruleSummary( rule ), ruleDetailsBody( rule ) );
}

function renderByRuleTab( agg: Aggregated ): string {
	if ( agg.byRule.length === 0 ) {
		return '<p class="empty">No violations found. 🎉</p>';
	}
	return agg.byRule.map( ( rule ) => renderRuleDetails( rule ) ).join( '\n' );
}

function renderByUrlTab( results: UrlResult[] ): string {
	return results.map( ( { url, results: res, error } ) => {
		const href = safeHref( url );
		const heading = href ? `<a href="${ href }" rel="noopener">${ esc( url ) }</a>` : esc( url );
		if ( error || ! res ) {
			return `<section class="url-card" data-search="${ searchText( url, error ) }">
				<h3>${ heading }</h3>
				<p class="scan-error">⚠️ Scan failed: ${ esc( error ?? 'no results recorded' ) }</p>
			</section>`;
		}
		const nodeTotal = res.violations.reduce( ( n, v ) => n + v.nodes.length, 0 );
		const passCount = Array.isArray( res.passes ) ? res.passes.length : 0;
		const search = searchText( url, ...res.violations.flatMap( ( v ) => [ v.id, v.help, v.description ] ) );
		const impacts = [ ...new Set( res.violations.map( ( v ) => impactKey( v.impact ) ) ) ].join( ' ' );
		if ( res.violations.length === 0 ) {
			return `<section class="url-card" data-search="${ search }">
				<h3>${ heading }</h3>
				<p><span class="badge badge-pass"><span class="dot" aria-hidden="true"></span>0 violations</span>
				<span class="muted">${ plural( passCount, 'passed rule' ) }</span></p>
			</section>`;
		}
		const sorted = [ ...res.violations ].sort( ( a, b ) => impactRank( b.impact ) - impactRank( a.impact ) );
		const rows = sorted.map( ( v ) => `<li>${ badge( v.impact ) } <code>${ esc( v.id ) }</code>
			${ esc( v.help ?? '' ) } <span class="muted">(${ plural( v.nodes.length, 'element' ) })</span></li>` );
		return `<section class="url-card" data-search="${ search }" data-impacts="${ esc( impacts ) }">
			<h3>${ heading }</h3>
			<p class="muted">${ plural( nodeTotal, 'violation' ) } · ${ plural( passCount, 'passed rule' ) }</p>
			<ul class="url-violations">${ rows.join( '' ) }</ul>
		</section>`;
	} ).join( '\n' );
}

function renderByGroupTab( agg: Aggregated ): string {
	const buckets = new Map<GroupName, RuleGroup[]>();
	for ( const rule of agg.byRule ) {
		const group = groupForTags( rule.tags );
		buckets.set( group, [ ...( buckets.get( group ) ?? [] ), rule ] );
	}
	const sections = GROUP_ORDER.filter( ( g ) => buckets.has( g ) ).map( ( g ) => {
		const rules = buckets.get( g )!;
		const total = rules.reduce( ( n, r ) => n + r.nodeCount, 0 );
		const items = rules.map( ( rule ) => accordion( rule, 4, ruleSummary( rule ), `
				${ ruleDetailsBody( rule ) }
				<p class="muted">Tags: ${ esc( rule.tags.join( ', ' ) ) }</p>` ) );
		return `<section>
			<h3>${ esc( g ) } <span class="muted">(${ plural( rules.length, 'rule' ) }, ${ plural( total, 'element' ) })</span></h3>
			${ items.join( '' ) }
		</section>`;
	} );
	return sections.length > 0 ? sections.join( '\n' ) : '<p class="empty">No violations found. 🎉</p>';
}

/** Flat stream of every violation instance (one entry per affected element), most severe first. */
function renderStreamTab( results: UrlResult[] ): string {
	type StreamEntry = { url: string; id: string; impact: string | null | undefined; help: string; description: string; node: AxeNodeResult };
	const entries: StreamEntry[] = [];
	for ( const { url, results: res } of results ) {
		if ( ! res ) {
			continue;
		}
		for ( const v of res.violations ) {
			for ( const node of v.nodes ) {
				entries.push( { url, id: v.id, impact: v.impact, help: v.help ?? '', description: v.description ?? '', node } );
			}
		}
	}
	entries.sort( ( a, b ) => impactRank( b.impact ) - impactRank( a.impact ) );
	if ( entries.length === 0 ) {
		return '<p class="empty">No violations found. 🎉</p>';
	}
	const items = entries.map( ( e ) => {
		const target = Array.isArray( e.node.target ) ? e.node.target.map( ( t ) => String( t ) ).join( ' ' ) : '';
		const snippet = ( e.node.html ?? '' ).length > 300 ? `${ e.node.html!.slice( 0, 300 ) }…` : e.node.html ?? '';
		return `<article class="stream-item" data-search="${ searchText( e.url, e.id, e.help, e.description ) }" data-impacts="${ impactKey( e.impact ) }">
			<h3 class="stream-head">${ badge( e.impact ) } <code>${ esc( e.id ) }</code>
				<span class="rule-help">${ esc( e.help ) }</span>
				<span class="stream-url">${ esc( e.url ) }</span></h3>
			${ target ? `<code class="target">${ esc( target ) }</code>` : '' }
			${ snippet ? `<code class="snippet">${ highlightHtml( snippet ) }</code>` : '' }
			${ e.node.failureSummary ? `<pre class="failure">${ esc( e.node.failureSummary ) }</pre>` : '' }
		</article>`;
	} );
	return items.join( '\n' );
}

/** Grouping of violations by persona, shared by the cards and table views. */
type PersonaGrouping = {
	byPersona: Map<string, RuleGroup[]>;
	unmapped: RuleGroup[];
};

function groupByPersona( agg: Aggregated ): PersonaGrouping {
	const byPersona = new Map<string, RuleGroup[]>();
	for ( const rule of agg.byRule ) {
		for ( const persona of gdsPersonasForRule( rule.id ) ) {
			byPersona.set( persona.key, [ ...( byPersona.get( persona.key ) ?? [] ), rule ] );
		}
	}
	const unmapped = agg.byRule.filter( ( rule ) => gdsPersonasForRule( rule.id ).length === 0 );
	return { byPersona, unmapped };
}

/** Cards view: one card per real GDS persona — who they are, what they need, and the rules whose violations affect them. */
function renderPersonaCardsView( grouping: PersonaGrouping ): string {
	const { byPersona, unmapped } = grouping;

	const cards = GDS_PERSONAS.map( ( persona ) => {
		const rules = byPersona.get( persona.key ) ?? [];
		const elementTotal = rules.reduce( ( n, r ) => n + r.nodeCount, 0 );
		const list = rules.length === 0
			? "<p class=\"persona-gap\">None of this run's rules map to this persona's primary needs. Automation coverage here is limited — prioritize manual testing.</p>"
			: `<ul class="persona-rules">${ rules.map( ( r ) => `<li>${ badge( r.impact ) } <code>${ esc( r.id ) }</code>
				<span class="muted">(${ plural( r.nodeCount, 'element' ) })</span></li>` ).join( '' ) }</ul>`;
		return `<section class="persona-card">
			<p class="persona-eyebrow">${ esc( persona.userType ) }</p>
			<h3><span class="persona-icon" aria-hidden="true">${ esc( persona.icon ) }</span> ${ esc( persona.name ) }</h3>
			<p class="persona-desc">${ esc( persona.identity ) }</p>
			<p class="persona-needs"><span class="persona-needs-label">Needs:</span> ${ esc( persona.needs ) }</p>
			<p class="persona-stats">${ plural( rules.length, 'rule' ) } · ${ plural( elementTotal, 'affected element' ) }</p>
			${ list }
		</section>`;
	} );

	const unmappedSection = unmapped.length === 0 ? '' : `<section class="persona-card persona-unmapped">
		<h3><span class="persona-icon" aria-hidden="true">?</span> Not yet mapped</h3>
		<p class="persona-desc">These rules aren't in the curated GOV.UK / GDS persona map yet — review them manually.</p>
		<ul class="persona-rules">${ unmapped.map( ( r ) => `<li>${ badge( r.impact ) } <code>${ esc( r.id ) }</code></li>` ).join( '' ) }</ul>
	</section>`;

	return `<div class="persona-grid">${ cards.join( '\n' ) }${ unmappedSection }</div>`;
}

/** Table view: one row per real GDS persona — user type, needs, and issues at a glance. Denser than the cards. */
function renderPersonaTableView( grouping: PersonaGrouping ): string {
	const { byPersona, unmapped } = grouping;

	const rows = GDS_PERSONAS.map( ( persona ) => {
		const rules = byPersona.get( persona.key ) ?? [];
		const elementTotal = rules.reduce( ( n, r ) => n + r.nodeCount, 0 );
		const issues = rules.length === 0
			? '<span class="persona-clear">None this run</span>'
			: `<ul class="persona-table-issues">${ rules.map( ( r ) => `<li>${ badge( r.impact ) } <code>${ esc( r.id ) }</code></li>` ).join( '' ) }</ul>`;
		return `<tr>
			<th scope="row"><span class="persona-icon" aria-hidden="true">${ esc( persona.icon ) }</span> ${ esc( persona.name ) }</th>
			<td>${ esc( persona.userType ) }</td>
			<td>${ issues }</td>
			<td>${ plural( rules.length, 'rule' ) } · ${ plural( elementTotal, 'element' ) }</td>
		</tr>`;
	} );
	if ( unmapped.length > 0 ) {
		rows.push( `<tr>
			<th scope="row"><span class="persona-icon" aria-hidden="true">?</span> Not yet mapped</th>
			<td>Unmapped</td>
			<td><ul class="persona-table-issues">${ unmapped.map( ( r ) => `<li>${ badge( r.impact ) } <code>${ esc( r.id ) }</code></li>` ).join( '' ) }</ul></td>
			<td>${ plural( unmapped.length, 'rule' ) }</td>
		</tr>` );
	}

	return `<div class="persona-table-wrap">
		<table class="persona-table">
			<caption class="sr-only">All personas with their user type and issues</caption>
			<thead><tr><th scope="col">Persona</th><th scope="col">User type</th><th scope="col">Issues</th><th scope="col">Totals</th></tr></thead>
			<tbody>${ rows.join( '\n' ) }</tbody>
		</table>
	</div>`;
}

/** The Personas page: a Cards view and a denser Table view of the same underlying grouping. */
function renderPersonasPage( agg: Aggregated ): string {
	const grouping = groupByPersona( agg );
	const views = [
		{ id: 'persona-cards', label: 'Cards', body: renderPersonaCardsView( grouping ) },
		{ id: 'persona-table', label: 'Table', body: renderPersonaTableView( grouping ) },
	];
	const viewTabs = views.map( ( v, i ) =>
		`<button role="tab" id="tab-${ v.id }" aria-controls="panel-${ v.id }" aria-selected="${ i === 0 }" tabindex="${ i === 0 ? 0 : -1 }">${ v.label }</button>`
	).join( '' );
	const viewPanels = views.map( ( v, i ) =>
		`<div role="tabpanel" id="panel-${ v.id }" aria-labelledby="tab-${ v.id }"${ i === 0 ? '' : ' hidden' }>${ v.body }</div>`
	).join( '\n' );

	return `<h2 class="page-title">Who is affected</h2>
	<p class="page-intro">Each violation is mapped to the real people from the GOV.UK / GDS accessibility persona set it's most likely to affect — not just a disability category. These are planning tools, not simulations of disabled people or a substitute for testing with disabled users.</p>
	<div role="tablist" aria-label="Persona views" class="persona-view-tabs">${ viewTabs }</div>
	${ viewPanels }`;
}

const STYLE = `
/* GLASS MAX — maximal glassmorphic aurora dashboard. CSS-only over the stock report markup. */
:root {
	--ink: #eef0ff; --ink-2: #c3c8e8; --muted: #8d93bd;
	--critical: #ff5c7a; --serious: #ff9760; --moderate: #ffd166;
	--minor: #9aa5d1; --none: #7d86b0; --pass: #4ce0a3;
	--accent: #8b7cff; --accent-2: #4cc3ff;
	--glass: rgba(18, 20, 46, 0.72);
	--glass-strong: rgba(14, 16, 38, 0.86);
	--glass-border: rgba(255, 255, 255, 0.14);
	--glass-highlight: rgba(255, 255, 255, 0.28);
	--page: #0a0b1e;
	--aur-a: rgba(124, 77, 255, 0.35); --aur-b: rgba(56, 189, 248, 0.28);
	--aur-c: rgba(255, 92, 122, 0.18); --aur-d: rgba(76, 224, 163, 0.14);
	--blob-a: rgba(139, 124, 255, 0.22); --blob-b: rgba(76, 195, 255, 0.18); --blob-c: rgba(255, 151, 96, 0.10);
	--grain-o: .5; --sh: 4, 6, 24;
	--well: rgba(8, 10, 28, 0.55); --well-2: rgba(5, 7, 22, 0.65); --well-3: rgba(8, 10, 28, 0.35);
	--well-strong: rgba(5, 7, 22, 0.85);
	--mix-ink: #ffffff; --h1-a: #ffffff;
	--hl-tag: #7cc7ff; --hl-attr: #b8a6ff; --hl-value: #7fe0b0; --hl-comment: #7d86b0; --hl-punct: #8d93bd;
	color-scheme: dark;
	--radius: 18px;
}
:root[data-theme="light"] {
	--ink: #1c2140; --ink-2: #3d4370; --muted: #5c628f;
	--critical: #d31f45; --serious: #c2551a; --moderate: #9a6a00;
	--minor: #56618f; --none: #6d7499; --pass: #0b8f5f;
	--accent: #5346d6; --accent-2: #0270b8;
	--glass: rgba(255, 255, 255, 0.62);
	--glass-strong: rgba(255, 255, 255, 0.82);
	--glass-border: rgba(35, 42, 95, 0.16);
	--glass-highlight: rgba(255, 255, 255, 0.95);
	--page: #e9edf9;
	--aur-a: rgba(124, 77, 255, 0.18); --aur-b: rgba(56, 189, 248, 0.16);
	--aur-c: rgba(255, 92, 122, 0.10); --aur-d: rgba(76, 224, 163, 0.10);
	--blob-a: rgba(139, 124, 255, 0.14); --blob-b: rgba(76, 195, 255, 0.12); --blob-c: rgba(255, 151, 96, 0.07);
	--grain-o: .28; --sh: 92, 100, 155;
	--well: rgba(255, 255, 255, 0.72); --well-2: rgba(243, 246, 255, 0.9); --well-3: rgba(234, 238, 252, 0.6);
	--well-strong: rgba(255, 255, 255, 0.92);
	--mix-ink: #1c2140; --h1-a: #1c2140;
	--hl-tag: #0b63b8; --hl-attr: #6a3fd8; --hl-value: #0b7a4b; --hl-comment: #737a9e; --hl-punct: #5c628f;
	color-scheme: light;
}
@media (prefers-color-scheme: light) {
	:root:not([data-theme="dark"]) {
	--ink: #1c2140; --ink-2: #3d4370; --muted: #5c628f;
	--critical: #d31f45; --serious: #c2551a; --moderate: #9a6a00;
	--minor: #56618f; --none: #6d7499; --pass: #0b8f5f;
	--accent: #5346d6; --accent-2: #0270b8;
	--glass: rgba(255, 255, 255, 0.62);
	--glass-strong: rgba(255, 255, 255, 0.82);
	--glass-border: rgba(35, 42, 95, 0.16);
	--glass-highlight: rgba(255, 255, 255, 0.95);
	--page: #e9edf9;
	--aur-a: rgba(124, 77, 255, 0.18); --aur-b: rgba(56, 189, 248, 0.16);
	--aur-c: rgba(255, 92, 122, 0.10); --aur-d: rgba(76, 224, 163, 0.10);
	--blob-a: rgba(139, 124, 255, 0.14); --blob-b: rgba(76, 195, 255, 0.12); --blob-c: rgba(255, 151, 96, 0.07);
	--grain-o: .28; --sh: 92, 100, 155;
	--well: rgba(255, 255, 255, 0.72); --well-2: rgba(243, 246, 255, 0.9); --well-3: rgba(234, 238, 252, 0.6);
	--well-strong: rgba(255, 255, 255, 0.92);
	--mix-ink: #1c2140; --h1-a: #1c2140;
	--hl-tag: #0b63b8; --hl-attr: #6a3fd8; --hl-value: #0b7a4b; --hl-comment: #737a9e; --hl-punct: #5c628f;
	color-scheme: light;
	}
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.sr-only {
	position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
	overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

html { scrollbar-color: rgba(139,124,255,.4) transparent; }
body {
	margin: 0; color: var(--ink); min-height: 100vh;
	font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
	-webkit-font-smoothing: antialiased;
	background: var(--page);
	background-image:
		radial-gradient(ellipse 80% 60% at 15% -10%, var(--aur-a), transparent 60%),
		radial-gradient(ellipse 70% 55% at 90% 5%, var(--aur-b), transparent 60%),
		radial-gradient(ellipse 65% 50% at 70% 95%, var(--aur-c), transparent 60%),
		radial-gradient(ellipse 50% 45% at 5% 80%, var(--aur-d), transparent 60%);
	background-attachment: fixed;
}
/* drifting aurora layer + film grain */
body::before {
	content: ""; position: fixed; inset: -20%; z-index: -2; pointer-events: none;
	background:
		radial-gradient(circle 480px at 30% 30%, var(--blob-a), transparent 70%),
		radial-gradient(circle 420px at 70% 60%, var(--blob-b), transparent 70%),
		radial-gradient(circle 380px at 45% 85%, var(--blob-c), transparent 70%);
	animation: aurora-drift 26s ease-in-out infinite alternate;
	filter: blur(28px) saturate(1.2);
}
body::after {
	content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: var(--grain-o);
	background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
}
@keyframes aurora-drift {
	0% { transform: translate3d(-4%, -2%, 0) rotate(0deg) scale(1); }
	100% { transform: translate3d(4%, 3%, 0) rotate(4deg) scale(1.08); }
}

main { max-width: 1020px; margin: 0 auto; padding: 48px 22px 90px; }

/* ---- Masthead ---- */
header.report {
	position: relative; padding: 26px 30px 22px; margin-bottom: 26px;
	background: linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 55%), var(--glass);
	border: 1px solid var(--glass-border); border-radius: calc(var(--radius) + 4px);
	backdrop-filter: blur(22px) saturate(1.4); -webkit-backdrop-filter: blur(22px) saturate(1.4);
	box-shadow: 0 24px 60px rgba(var(--sh), 0.55), inset 0 1px 0 var(--glass-highlight);
	overflow: hidden;
}
header.report::before {
	content: ""; position: absolute; top: -60%; left: -10%; width: 60%; height: 160%;
	background: linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.09) 50%, transparent 58%);
	transform: rotate(8deg); pointer-events: none;
}
header.report::after {
	content: "◈ AXE-CORE INTELLIGENCE"; position: absolute; bottom: 14px; right: 20px;
	font-size: 10px; font-weight: 700; letter-spacing: .28em; color: var(--muted);
	border: 1px solid var(--glass-border); border-radius: 999px; padding: 4px 12px;
	background: rgba(255,255,255,0.04);
}
header.report h1 {
	margin: 0 0 8px; font-size: 34px; font-weight: 750; letter-spacing: -0.03em; line-height: 1.15;
	background: linear-gradient(92deg, var(--h1-a) 10%, var(--accent-2) 55%, var(--accent) 90%);
	-webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
	filter: drop-shadow(0 2px 18px rgba(139, 124, 255, 0.35));
}
header.report .meta { color: var(--ink-2); font-size: 13px; margin: 0; letter-spacing: .02em; }


/* ---- Page nav ---- */
.page-nav {
	display: flex; margin-bottom: 20px;
}
.page-nav ul {
	display: inline-flex; gap: 4px; margin: 0; padding: 5px; list-style: none;
	background: var(--glass); border: 1px solid var(--glass-border); border-radius: 999px;
	backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
	box-shadow: 0 10px 26px rgba(var(--sh), 0.45), inset 0 1px 0 var(--glass-highlight);
}
.page-nav a {
	display: inline-block; border-radius: 999px; padding: 8px 22px;
	font-size: 14px; font-weight: 600; color: var(--muted); text-decoration: none;
	transition: color .15s, background .15s, box-shadow .15s;
}
.page-nav a:hover { color: var(--ink); }
.page-nav a[aria-current="page"] {
	color: #fff;
	background: linear-gradient(135deg, rgba(139,124,255,0.85), rgba(76,195,255,0.75));
	box-shadow: 0 0 22px rgba(139, 124, 255, 0.5), inset 0 1px 0 rgba(255,255,255,0.35);
	text-shadow: 0 1px 2px rgba(10, 11, 30, 0.4);
}
.page-nav a:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }

/* ---- Personas page ---- */
.page-title { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin: 4px 0 6px; }
.page-intro { color: var(--ink-2); font-size: 14px; margin: 0 0 22px; max-width: 70ch; }
.persona-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; align-items: start; }
.persona-card {
	background: linear-gradient(165deg, rgba(255,255,255,0.07), rgba(255,255,255,0.01) 55%), var(--glass);
	border: 1px solid var(--glass-border); border-radius: var(--radius);
	padding: 18px 20px;
	backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
	box-shadow: 0 12px 30px rgba(var(--sh), 0.45), inset 0 1px 0 var(--glass-highlight);
}
.persona-eyebrow {
	font-size: 11px; font-weight: 700; color: var(--accent-2); margin: 0 0 6px;
	text-transform: uppercase; letter-spacing: .08em;
}
.persona-card h3 { margin: 0 0 8px; font-size: 16px; font-weight: 650; display: flex; align-items: center; gap: 10px; }
.persona-icon {
	display: inline-flex; align-items: center; justify-content: center; flex: none;
	width: 34px; height: 34px; border-radius: 10px; font-size: 17px;
	color: var(--accent-2); background: var(--well);
	border: 1px solid var(--glass-border);
	text-shadow: 0 0 12px rgba(76, 195, 255, 0.5);
}
.persona-desc { color: var(--ink-2); font-size: 13.5px; margin: 0 0 8px; }
.persona-needs { color: var(--ink-2); font-size: 13.5px; margin: 0 0 10px; }
.persona-needs-label { font-weight: 700; color: var(--ink); }
.persona-stats {
	font-size: 12px; font-weight: 700; color: var(--accent-2); margin: 0 0 10px;
	text-transform: uppercase; letter-spacing: .08em;
}
.persona-clear { color: var(--pass); font-size: 14px; margin: 0; }
.persona-gap { color: var(--moderate); font-size: 13.5px; margin: 0; }
ul.persona-rules { margin: 0; padding: 0; list-style: none; }
ul.persona-rules li {
	display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
	padding: 6px 10px; margin-bottom: 6px; font-size: 13.5px;
	background: var(--well-3); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px;
}
ul.persona-rules code { font-weight: 700; font-size: 12.5px; color: var(--accent-2); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
.persona-unmapped .persona-icon { color: var(--moderate); text-shadow: 0 0 12px color-mix(in srgb, var(--moderate) 50%, transparent); }

.persona-view-tabs { margin-bottom: 18px; }

.persona-table-wrap {
	overflow-x: auto;
	border: 1px solid var(--glass-border); border-radius: var(--radius);
	background: var(--glass);
	backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
	box-shadow: 0 12px 30px rgba(var(--sh), 0.45), inset 0 1px 0 var(--glass-highlight);
}
table.persona-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.persona-table th, .persona-table td { padding: 12px 16px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--glass-border); }
.persona-table thead th { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
.persona-table tbody tr:last-child th, .persona-table tbody tr:last-child td { border-bottom: none; }
.persona-table th[scope="row"] { font-weight: 650; white-space: nowrap; display: flex; align-items: center; gap: 10px; }
.persona-table .persona-icon { width: 26px; height: 26px; font-size: 13px; border-radius: 8px; }
ul.persona-table-issues { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
ul.persona-table-issues li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
ul.persona-table-issues code { font-weight: 700; font-size: 12px; color: var(--accent-2); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }

/* ---- Persona chips in rule bodies ---- */
.personas { margin: 10px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.personas-label { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .12em; }
.persona-chip {
	display: inline-block; border-radius: 999px; padding: 2px 11px;
	font-size: 12px; font-weight: 600; color: var(--ink-2);
	background: var(--well); border: 1px solid var(--glass-border);
}

/* ---- Theme toggle ---- */
.theme-toggle {
	position: absolute; top: 14px; right: 16px; z-index: 5;
	display: inline-flex; gap: 3px; padding: 4px;
	background: var(--well); border: 1px solid var(--glass-border); border-radius: 999px;
	backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.theme-toggle button {
	background: none; border: 1px solid transparent; border-radius: 999px;
	padding: 4px 12px; font: inherit; font-size: 12px; font-weight: 600;
	color: var(--muted); cursor: pointer; transition: color .15s, background .15s;
}
.theme-toggle button:hover { color: var(--ink); }
.theme-toggle button[aria-pressed="true"] {
	color: #fff;
	background: linear-gradient(135deg, rgba(139,124,255,0.85), rgba(76,195,255,0.75));
	box-shadow: 0 0 14px rgba(139, 124, 255, 0.45), inset 0 1px 0 rgba(255,255,255,0.3);
	text-shadow: 0 1px 2px rgba(10, 11, 30, 0.4);
}
.theme-toggle button:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
header.report { padding-right: 240px; }
@media (max-width: 760px) {
	header.report { padding-right: 30px; }
	.theme-toggle { position: static; margin-bottom: 12px; }
}

/* ---- KPI tiles ---- */
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-bottom: 26px; perspective: 900px; }
.tile {
	--glow: var(--none);
	position: relative; overflow: hidden;
	background: linear-gradient(165deg, rgba(255,255,255,0.09), rgba(255,255,255,0.015) 60%), var(--glass);
	border: 1px solid var(--glass-border); border-radius: var(--radius);
	padding: 16px 16px 14px; cursor: pointer;
	font: inherit; color: inherit; text-align: left;
	display: flex; flex-direction: column; gap: 4px;
	backdrop-filter: blur(18px) saturate(1.35); -webkit-backdrop-filter: blur(18px) saturate(1.35);
	box-shadow: 0 14px 34px rgba(var(--sh), 0.5), inset 0 1px 0 var(--glass-highlight);
	transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.tile::before { /* colored orb glow */
	content: ""; position: absolute; top: -34px; right: -30px; width: 110px; height: 110px;
	border-radius: 50%; background: radial-gradient(circle, var(--glow), transparent 70%);
	opacity: .5; transition: opacity .18s, transform .18s;
}
.tile::after { /* bottom energy bar */
	content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
	background: linear-gradient(90deg, var(--glow), transparent 85%); opacity: .85;
}
.tile:hover { transform: translateY(-4px) rotateX(2deg); border-color: rgba(255,255,255,0.26); box-shadow: 0 24px 50px rgba(var(--sh), 0.6), inset 0 1px 0 var(--glass-highlight); }
.tile:hover::before { opacity: .85; transform: scale(1.15); }
.tile:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 3px; }
.tile .label { font-size: 11px; font-weight: 700; color: var(--ink-2); text-transform: uppercase; letter-spacing: .16em; display: flex; align-items: center; gap: 7px; }
.tile .label::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--glow); box-shadow: 0 0 10px var(--glow), 0 0 22px var(--glow); flex: none; }
.tile .value {
	font-size: 38px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.05;
	font-variant-numeric: tabular-nums;
	text-shadow: 0 0 26px color-mix(in srgb, var(--glow) 55%, transparent);
}
.tile-critical { --glow: var(--critical); }
.tile-serious { --glow: var(--serious); }
.tile-moderate { --glow: var(--moderate); }
.tile-minor { --glow: var(--minor); }
.tile-none { --glow: var(--none); }
.tile[aria-pressed="true"] {
	border-color: color-mix(in srgb, var(--glow) 70%, white 10%);
	box-shadow: 0 0 0 1px color-mix(in srgb, var(--glow) 65%, transparent),
		0 0 30px color-mix(in srgb, var(--glow) 40%, transparent),
		0 14px 34px rgba(var(--sh), 0.55), inset 0 1px 0 var(--glass-highlight);
	background: linear-gradient(165deg, color-mix(in srgb, var(--glow) 16%, transparent), rgba(255,255,255,0.02) 60%), var(--glass-strong);
}
.tile[aria-pressed="true"]::before { opacity: 1; }
.tile[aria-pressed="true"] .label::after {
	content: "ACTIVE"; position: absolute; bottom: 10px; right: 12px;
	font-size: 9px; letter-spacing: .2em;
	color: color-mix(in srgb, var(--glow) 45%, var(--mix-ink) 55%);
	background: var(--well-strong);
	border: 1px solid color-mix(in srgb, var(--glow) 55%, transparent);
	border-radius: 999px; padding: 2px 8px;
	box-shadow: 0 0 10px color-mix(in srgb, var(--glow) 30%, transparent);
}

/* ---- Search ---- */
.search {
	display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 14px;
	padding: 12px 16px;
	background: var(--glass); border: 1px solid var(--glass-border); border-radius: var(--radius);
	backdrop-filter: blur(18px) saturate(1.3); -webkit-backdrop-filter: blur(18px) saturate(1.3);
	box-shadow: 0 10px 28px rgba(var(--sh), 0.45), inset 0 1px 0 var(--glass-highlight);
}
.search label { font-size: 11px; font-weight: 700; color: var(--ink-2); text-transform: uppercase; letter-spacing: .18em; }
.search label::before { content: "⌕ "; color: var(--accent-2); font-size: 14px; letter-spacing: 0; }
.search input {
	flex: 1 1 300px; max-width: 480px; padding: 9px 14px; font: inherit; font-size: 14px;
	color: var(--ink); background: var(--well);
	border: 1px solid var(--glass-border); border-radius: 12px;
	transition: border-color .15s, box-shadow .15s;
}
.search input::placeholder { color: var(--muted); }
.search input:hover { border-color: rgba(255,255,255,0.28); }
.search input:focus-visible {
	outline: none; border-color: var(--accent-2);
	box-shadow: 0 0 0 3px rgba(76, 195, 255, 0.22), 0 0 24px rgba(76, 195, 255, 0.25);
}
.search-status { font-size: 13px; color: var(--accent-2); font-variant-numeric: tabular-nums; text-shadow: 0 0 14px rgba(76,195,255,.4); }

/* ---- Filter bar ---- */
.filter-bar {
	display: flex; flex-wrap: wrap; align-items: center; gap: 9px; margin-bottom: 18px;
	padding: 10px 16px;
	background: linear-gradient(90deg, rgba(139,124,255,0.10), rgba(76,195,255,0.06));
	border: 1px dashed rgba(139, 124, 255, 0.4); border-radius: 14px;
}
.filter-intro { font-size: 10px; font-weight: 800; color: var(--accent); text-transform: uppercase; letter-spacing: .24em; text-shadow: 0 0 12px rgba(139,124,255,.5); }
.filter-chip {
	display: inline-flex; align-items: center; gap: 7px;
	background: rgba(139, 124, 255, 0.16); border: 1px solid rgba(139, 124, 255, 0.55); border-radius: 999px;
	padding: 4px 14px; font: inherit; font-size: 13px; font-weight: 600; color: var(--ink); cursor: pointer;
	box-shadow: 0 0 16px rgba(139, 124, 255, 0.2), inset 0 1px 0 rgba(255,255,255,0.12);
	transition: box-shadow .15s, border-color .15s, transform .15s;
}
.filter-chip:hover { border-color: var(--accent); box-shadow: 0 0 26px rgba(139, 124, 255, 0.45), inset 0 1px 0 rgba(255,255,255,0.16); transform: translateY(-1px); }
.filter-chip .chip-x { font-size: 11px; color: var(--accent-2); }
.filter-chip:focus-visible, .filter-clear:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
.filter-clear {
	background: none; border: 1px solid transparent; padding: 4px 10px; font: inherit; font-size: 12px; font-weight: 600;
	color: var(--muted); cursor: pointer; border-radius: 999px; letter-spacing: .04em;
}
.filter-clear:hover { color: var(--ink); border-color: var(--glass-border); background: rgba(255,255,255,0.05); }

/* ---- Tabs ---- */
[role="tablist"] {
	display: inline-flex; gap: 4px; margin-bottom: 24px; padding: 5px;
	background: var(--glass); border: 1px solid var(--glass-border); border-radius: 999px;
	backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
	box-shadow: 0 10px 26px rgba(var(--sh), 0.45), inset 0 1px 0 var(--glass-highlight);
}
[role="tab"] {
	background: none; border: 1px solid transparent; border-radius: 999px;
	padding: 8px 22px; font: inherit; font-size: 14px; font-weight: 600;
	color: var(--muted); cursor: pointer; letter-spacing: .01em;
	transition: color .15s, background .15s, box-shadow .15s;
}
[role="tab"]:hover { color: var(--ink); }
[role="tab"][aria-selected="true"] {
	color: #fff;
	background: linear-gradient(135deg, rgba(139,124,255,0.85), rgba(76,195,255,0.75));
	box-shadow: 0 0 22px rgba(139, 124, 255, 0.5), inset 0 1px 0 rgba(255,255,255,0.35);
	text-shadow: 0 1px 2px rgba(10, 11, 30, 0.4);
}
[role="tab"]:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
[role="tabpanel"][hidden] { display: none; }

/* ---- Badges ---- */
.badge {
	--bcol: var(--none);
	display: inline-flex; align-items: center; gap: 6px;
	border-radius: 999px; padding: 2px 11px 2px 8px;
	font-size: 12px; font-weight: 700; letter-spacing: .04em; white-space: nowrap;
	color: color-mix(in srgb, var(--bcol) 78%, var(--mix-ink) 22%);
	background: color-mix(in srgb, var(--bcol) 14%, transparent);
	border: 1px solid color-mix(in srgb, var(--bcol) 45%, transparent);
	box-shadow: 0 0 14px color-mix(in srgb, var(--bcol) 22%, transparent);
	text-transform: uppercase;
}
.badge .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--bcol); box-shadow: 0 0 8px var(--bcol); flex: none; }
.badge-critical { --bcol: var(--critical); }
.badge-serious { --bcol: var(--serious); }
.badge-moderate { --bcol: var(--moderate); }
.badge-minor { --bcol: var(--minor); }
.badge-pass { --bcol: var(--pass); }

/* ---- Rule accordions ---- */
.rule {
	--rcol: var(--none);
	position: relative;
	background: linear-gradient(165deg, rgba(255,255,255,0.07), rgba(255,255,255,0.01) 55%), var(--glass);
	border: 1px solid var(--glass-border); border-radius: var(--radius);
	margin-bottom: 12px; overflow: hidden;
	backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
	box-shadow: 0 12px 30px rgba(var(--sh), 0.45), inset 0 1px 0 var(--glass-highlight);
	transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.rule::before { /* neon rail */
	content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
	background: linear-gradient(180deg, var(--rcol), color-mix(in srgb, var(--rcol) 30%, transparent));
	box-shadow: 0 0 12px var(--rcol);
}
.rule:has(.badge-critical) { --rcol: var(--critical); }
.rule:has(.badge-serious) { --rcol: var(--serious); }
.rule:has(.badge-moderate) { --rcol: var(--moderate); }
.rule:has(.badge-minor) { --rcol: var(--minor); }
.rule:hover { transform: translateX(3px); border-color: rgba(255,255,255,0.24); }
.rule-heading { margin: 0; font-size: inherit; font-weight: inherit; }
.rule-toggle {
	display: flex; flex-wrap: wrap; align-items: center; gap: 11px; width: 100%;
	padding: 15px 18px 15px 20px; cursor: pointer; background: none; border: none;
	font: inherit; color: inherit; text-align: left;
}
.rule-toggle:focus-visible { outline: 2px solid var(--accent-2); outline-offset: -3px; border-radius: var(--radius); }
.rule-toggle code { font-weight: 700; font-size: 13.5px; color: var(--accent-2); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; text-shadow: 0 0 14px rgba(76,195,255,.35); }
.disclosure { color: var(--accent); font-size: 12px; transition: transform 0.18s ease; flex: none; filter: drop-shadow(0 0 6px rgba(139,124,255,.6)); }
.rule-toggle[aria-expanded="true"] .disclosure { transform: rotate(90deg); }
.rule-help { color: var(--ink-2); flex: 1 1 250px; font-size: 14px; }
.counts {
	color: var(--ink-2); font-size: 11.5px; margin-left: auto; font-variant-numeric: tabular-nums;
	border: 1px solid var(--glass-border); border-radius: 999px; padding: 3px 11px;
	background: rgba(255,255,255,0.04); letter-spacing: .03em; white-space: nowrap;
}
.rule-body {
	padding: 16px 20px 18px; border-top: 1px solid var(--glass-border);
	background: var(--well-3); font-size: 14px;
}
.rule-body > p:first-child { margin-top: 0; color: var(--ink-2); }
.rule-url h4 { margin: 18px 0 8px; font-size: 13px; font-weight: 650; word-break: break-all; color: var(--accent-2); }
.rule-url h4::before { content: "⌁ "; color: var(--accent); }
ul.nodes { margin: 0; padding-left: 20px; }
ul.nodes li { margin-bottom: 12px; }
ul.nodes li::marker { color: var(--accent); }
code.target, code.snippet {
	display: block; overflow-x: auto; background: var(--well-2);
	border: 1px solid var(--glass-border); border-radius: 10px;
	padding: 7px 11px; font-size: 12.5px; margin: 3px 0;
	font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
	box-shadow: inset 0 1px 4px rgba(0,0,0,0.35);
}
code.target { color: var(--pass); }
code.snippet { color: var(--ink-2); }
.hljs-tag { color: var(--hl-punct); }
.hljs-name { color: var(--hl-tag); font-weight: 600; }
.hljs-attr { color: var(--hl-attr); }
.hljs-string { color: var(--hl-value); }
.hljs-comment { color: var(--hl-comment); font-style: italic; }
.hljs-symbol, .hljs-meta { color: var(--hl-punct); }
code.snippet { color: var(--ink-2); }
pre.failure {
	margin: 7px 0 0; padding: 11px 14px; overflow-x: auto;
	background: color-mix(in srgb, var(--critical) 10%, var(--well-2));
	border: 1px solid color-mix(in srgb, var(--critical) 30%, transparent);
	border-left: 3px solid var(--critical); border-radius: 10px;
	font-size: 12.5px; white-space: pre-wrap; color: var(--ink-2);
	font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
	box-shadow: 0 0 18px color-mix(in srgb, var(--critical) 12%, transparent);
}

/* ---- URL cards ---- */
.url-card {
	position: relative;
	background: linear-gradient(165deg, rgba(255,255,255,0.07), rgba(255,255,255,0.01) 55%), var(--glass);
	border: 1px solid var(--glass-border); border-radius: var(--radius);
	padding: 18px 20px; margin-bottom: 14px; overflow: hidden;
	backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
	box-shadow: 0 12px 30px rgba(var(--sh), 0.45), inset 0 1px 0 var(--glass-highlight);
	transition: transform .16s ease, border-color .16s ease;
}
.url-card:hover { transform: translateY(-2px); border-color: rgba(255,255,255,0.24); }
.url-card h3 { margin: 0 0 8px; font-size: 15.5px; font-weight: 650; word-break: break-all; letter-spacing: -0.01em; }
.url-card h3::before { content: "⛁ "; color: var(--accent-2); font-weight: 400; }
.url-card a { color: var(--accent-2); text-decoration: none; }
.url-card a:hover { text-decoration: underline; text-shadow: 0 0 16px rgba(76,195,255,.5); }
ul.url-violations { margin: 12px 0 0; padding-left: 0; list-style: none; }
ul.url-violations li {
	margin-bottom: 8px; font-size: 14px; padding: 7px 12px;
	background: var(--well-3); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px;
	display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
}
ul.url-violations code { font-size: 13px; font-weight: 700; color: var(--accent-2); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }

/* ---- Violation stream ---- */
.stream-item {
	--rcol: var(--none);
	position: relative;
	background: linear-gradient(165deg, rgba(255,255,255,0.07), rgba(255,255,255,0.01) 55%), var(--glass);
	border: 1px solid var(--glass-border); border-radius: var(--radius);
	padding: 14px 18px 14px 20px; margin-bottom: 12px; overflow: hidden;
	backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3);
	box-shadow: 0 12px 30px rgba(var(--sh), 0.45), inset 0 1px 0 var(--glass-highlight);
	transition: transform .16s ease, border-color .16s ease;
}
.stream-item::before {
	content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
	background: linear-gradient(180deg, var(--rcol), color-mix(in srgb, var(--rcol) 30%, transparent));
	box-shadow: 0 0 12px var(--rcol);
}
.stream-item:has(.badge-critical) { --rcol: var(--critical); }
.stream-item:has(.badge-serious) { --rcol: var(--serious); }
.stream-item:has(.badge-moderate) { --rcol: var(--moderate); }
.stream-item:has(.badge-minor) { --rcol: var(--minor); }
.stream-item:hover { transform: translateX(3px); border-color: rgba(255,255,255,0.24); }
.stream-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 0 0 9px; font-size: inherit; font-weight: inherit; }
.stream-head code { font-weight: 700; font-size: 13.5px; color: var(--accent-2); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; text-shadow: 0 0 14px rgba(76,195,255,.35); }
.stream-url { flex-basis: 100%; color: var(--muted); font-size: 12.5px; word-break: break-all; }
.stream-url::before { content: "⛁ "; color: var(--accent-2); }

/* ---- Group sections ---- */
section > h3 {
	font-size: 13px; font-weight: 800; letter-spacing: .2em; text-transform: uppercase;
	margin: 32px 0 14px; color: var(--ink-2);
	display: flex; align-items: center; gap: 12px;
}
section > h3::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, var(--glass-border), transparent); }
section > h3::before { content: "▣"; color: var(--accent); filter: drop-shadow(0 0 8px rgba(139,124,255,.6)); }

.scan-error {
	color: color-mix(in srgb, var(--critical) 80%, var(--mix-ink) 20%); font-size: 14px;
	padding: 9px 13px; border-radius: 10px;
	background: color-mix(in srgb, var(--critical) 12%, transparent);
	border: 1px solid color-mix(in srgb, var(--critical) 35%, transparent);
	display: inline-block;
}
.muted { color: var(--muted); }
.empty { font-size: 18px; color: var(--ink-2); text-align: center; padding: 40px 0; }
a { color: var(--accent-2); }

::selection { background: rgba(139, 124, 255, 0.45); }
@media (prefers-reduced-motion: reduce) {
	*, body::before { transition: none !important; animation: none !important; }
	.tile:hover, .rule:hover, .url-card:hover, .filter-chip:hover { transform: none; }
}

/* ---- Sidebar layout (default) ---- */
main { max-width: 1240px; }
.layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 24px; align-items: start; }
.side { position: sticky; top: 24px; display: flex; flex-direction: column; gap: 14px; }
.side .tiles { grid-template-columns: 1fr; gap: 10px; margin-bottom: 0; perspective: none; }
.side .tile { flex-direction: row; align-items: center; justify-content: space-between; padding: 11px 14px; }
.side .tile .value { font-size: 24px; }
.side .tile:hover { transform: none; }
.side .tile[aria-pressed="true"] .label::after { position: static; margin-left: 10px; }
.side .search { flex-direction: column; align-items: stretch; gap: 8px; margin-bottom: 0; }
.side .search input { max-width: none; flex: none; }
.side .filter-bar { margin-bottom: 0; }
@media (max-width: 920px) {
	.layout { grid-template-columns: 1fr; }
	.side { position: static; }
	.side .tiles { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
}
`;

const SCRIPT = `
const tablists = [...document.querySelectorAll('[role="tablist"]')];
for (const tablist of tablists) {
	const tabs = [...tablist.querySelectorAll('[role="tab"]')];
	const needsFilter = tablist.closest('#page-report') != null;
	function select(tab) {
		for (const t of tabs) {
			const on = t === tab;
			t.setAttribute('aria-selected', String(on));
			t.tabIndex = on ? 0 : -1;
			document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
		}
		tab.focus();
		if (needsFilter) applyFilter();
	}
	for (const tab of tabs) {
		tab.addEventListener('click', () => select(tab));
		tab.addEventListener('keydown', (e) => {
			const i = tabs.indexOf(tab);
			let next = null;
			if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
			if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
			if (e.key === 'Home') next = tabs[0];
			if (e.key === 'End') next = tabs[tabs.length - 1];
			if (next) { e.preventDefault(); select(next); }
		});
	}
}

const IMPACT_NAMES = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor', none: 'No impact' };
const searchInput = document.getElementById('search-input');
const searchStatus = document.getElementById('search-status');
const filterBar = document.getElementById('filter-bar');
const impactTiles = [...document.querySelectorAll('[data-impact-filter]')];
const activeImpacts = new Set();
let wasFiltered = false;

function makeChip(label, onRemove) {
	const chip = document.createElement('button');
	chip.type = 'button';
	chip.className = 'filter-chip';
	chip.append(label);
	const x = document.createElement('span');
	x.className = 'chip-x';
	x.setAttribute('aria-hidden', 'true');
	x.textContent = '✕';
	chip.append(' ', x);
	chip.setAttribute('aria-label', 'Remove filter: ' + label);
	chip.addEventListener('click', onRemove);
	return chip;
}

function renderFilterBar(query) {
	filterBar.textContent = '';
	const chips = [];
	for (const key of Object.keys(IMPACT_NAMES)) {
		if (!activeImpacts.has(key)) continue;
		const chip = makeChip(IMPACT_NAMES[key], () => toggleImpact(key));
		chip.classList.add('chip-' + key);
		chips.push(chip);
	}
	if (query) {
		chips.push(makeChip('Search: “' + query + '”', () => { searchInput.value = ''; applyFilter(); }));
	}
	filterBar.hidden = chips.length === 0;
	if (chips.length === 0) return;
	const intro = document.createElement('span');
	intro.className = 'filter-intro';
	intro.textContent = 'Filtering by:';
	filterBar.append(intro, ...chips);
	if (chips.length > 1) {
		const clear = document.createElement('button');
		clear.type = 'button';
		clear.className = 'filter-clear';
		clear.textContent = 'Clear all';
		clear.addEventListener('click', () => {
			activeImpacts.clear();
			searchInput.value = '';
			applyFilter();
		});
		filterBar.append(clear);
	}
}

function applyFilter() {
	const query = searchInput.value.trim().toLowerCase();
	for (const tile of impactTiles) {
		tile.setAttribute('aria-pressed', String(activeImpacts.has(tile.getAttribute('data-impact-filter'))));
	}
	const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
	const items = [...panel.querySelectorAll('[data-search]')];
	let shown = 0;
	for (const el of items) {
		const impacts = (el.getAttribute('data-impacts') || '').split(' ');
		const matchesQuery = !query || el.getAttribute('data-search').includes(query);
		const matchesImpact = activeImpacts.size === 0 || impacts.some((i) => activeImpacts.has(i));
		el.hidden = !(matchesQuery && matchesImpact);
		if (!el.hidden) shown++;
	}
	for (const section of panel.querySelectorAll('section:not(.url-card)')) {
		section.hidden = !section.querySelector('[data-search]:not([hidden])');
	}
	const filtered = Boolean(query) || activeImpacts.size > 0;
	if (filtered) {
		searchStatus.textContent = 'Showing ' + shown + ' of ' + items.length + ' results';
	} else {
		searchStatus.textContent = wasFiltered ? 'Filters cleared. Showing all ' + items.length + ' results' : '';
	}
	wasFiltered = filtered;
	renderFilterBar(query);
}

function toggleImpact(key) {
	if (activeImpacts.has(key)) activeImpacts.delete(key);
	else activeImpacts.add(key);
	applyFilter();
}

for (const tile of impactTiles) {
	tile.addEventListener('click', () => toggleImpact(tile.getAttribute('data-impact-filter')));
}

for (const toggle of document.querySelectorAll('.rule-toggle')) {
	toggle.addEventListener('click', () => {
		const expanded = toggle.getAttribute('aria-expanded') === 'true';
		toggle.setAttribute('aria-expanded', String(!expanded));
		document.getElementById(toggle.getAttribute('aria-controls')).hidden = expanded;
	});
}

let searchTimer;
searchInput.addEventListener('input', () => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(applyFilter, 200);
});
searchInput.addEventListener('search', applyFilter);

const pages = [...document.querySelectorAll('.page')];
const pageLinks = [...document.querySelectorAll('.page-nav a')];
function syncPage() {
	const hash = location.hash === '#page-personas' ? '#page-personas' : '#page-report';
	for (const p of pages) {
		p.hidden = ('#' + p.id) !== hash;
	}
	for (const a of pageLinks) {
		if (a.getAttribute('href') === hash) {
			a.setAttribute('aria-current', 'page');
		} else {
			a.removeAttribute('aria-current');
		}
	}
}
window.addEventListener('hashchange', syncPage);
syncPage();

const themeButtons = [...document.querySelectorAll('[data-theme-choice]')];
function applyTheme(choice) {
	if (choice === 'system') {
		document.documentElement.removeAttribute('data-theme');
	} else {
		document.documentElement.setAttribute('data-theme', choice);
	}
	for (const b of themeButtons) {
		b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-choice') === choice));
	}
	try { localStorage.setItem('axe-report-theme', choice); } catch {}
}
let savedTheme = 'system';
try {
	const stored = localStorage.getItem('axe-report-theme');
	if (stored === 'light' || stored === 'dark' || stored === 'system') savedTheme = stored;
} catch {}
applyTheme(savedTheme);
for (const b of themeButtons) {
	b.addEventListener('click', () => applyTheme(b.getAttribute('data-theme-choice')));
}
`;

const TILE_ORDER: ImpactKey[] = [ 'critical', 'serious', 'moderate', 'minor', 'none' ];

/** Render the whole self-contained report page. */
export function renderReport( title: string, results: UrlResult[], agg: Aggregated ): string {
	const tiles = TILE_ORDER.map( ( key ) => `<button type="button" class="tile tile-${ key }" data-impact-filter="${ key }" aria-pressed="false">
		<span class="label">${ IMPACT_LABELS[ key ] }</span>
		<span class="value">${ agg.counts[ key ] }</span>
	</button>` ).join( '' );

	const metaParts = [
		`Generated ${ new Date().toISOString().slice( 0, 16 ).replace( 'T', ' ' ) } UTC`,
		agg.engine || null,
		`${ plural( agg.scannedUrls, 'URL' ) } scanned${ agg.erroredUrls ? ` (${ agg.erroredUrls } failed)` : '' }`,
		`${ plural( agg.totalViolations, 'violation' ) }`,
	].filter( Boolean );

	const tabDefs = [
		{ id: 'rule', label: 'By rule', heading: 'Violations by rule', body: renderByRuleTab( agg ) },
		{ id: 'url', label: 'By URL', heading: 'Violations by URL', body: renderByUrlTab( results ) },
		{ id: 'group', label: 'By group', heading: 'Violations by group', body: renderByGroupTab( agg ) },
		{ id: 'stream', label: 'All violations', heading: 'All violations', body: renderStreamTab( results ) },
	];
	const tabButtons = tabDefs.map( ( t, i ) =>
		`<button role="tab" id="tab-${ t.id }" aria-controls="panel-${ t.id }" aria-selected="${ i === 0 }" tabindex="${ i === 0 ? 0 : -1 }">${ t.label }</button>`
	).join( '' );
	const tabPanels = tabDefs.map( ( t, i ) =>
		`<div role="tabpanel" id="panel-${ t.id }" aria-labelledby="tab-${ t.id }"${ i === 0 ? '' : ' hidden' }><h2 class="sr-only">${ t.heading }</h2>${ t.body }</div>`
	).join( '\n' );

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${ esc( title ) }</title>
<style>${ STYLE }</style>
</head>
<body>
<main>
	<nav class="page-nav" aria-label="Report pages">
		<ul>
			<li><a href="#page-report" aria-current="page">Report</a></li>
			<li><a href="#page-personas">Personas</a></li>
		</ul>
	</nav>
	<header class="report">
		<div class="theme-toggle" role="group" aria-label="Color theme">
			<button type="button" data-theme-choice="light" aria-pressed="false">☀ Light</button>
			<button type="button" data-theme-choice="system" aria-pressed="true">◐ System</button>
			<button type="button" data-theme-choice="dark" aria-pressed="false">☾ Dark</button>
		</div>
		<h1>${ esc( title ) }</h1>
		<p class="meta">${ metaParts.map( ( p ) => esc( p! ) ).join( ' · ' ) }</p>
	</header>
	<div class="page" id="page-report">
	<div class="layout">
		<aside class="side">
			<div class="search">
				<label for="search-input">Search</label>
				<input type="search" id="search-input" placeholder="Filter by rule, description, or URL…" autocomplete="off">
				<span class="search-status" id="search-status" role="status" aria-live="polite"></span>
			</div>
			<div class="tiles">${ tiles }</div>
			<div class="filter-bar" id="filter-bar" role="group" aria-label="Active filters" hidden></div>
		</aside>
		<div class="content">
			<div role="tablist" aria-label="Violation views">${ tabButtons }</div>
			${ tabPanels }
		</div>
	</div>
	</div>
	<div class="page" id="page-personas" hidden>
		${ renderPersonasPage( agg ) }
	</div>
</main>
<script>${ SCRIPT }</script>
</body>
</html>
`;
}

export interface HtmlReportOptions {
	/** Report title shown in the page header and browser tab. Default 'Accessibility report'. */
	title?: string;
}

/**
 * Build a polished, self-contained HTML accessibility report: tabs (by rule, by
 * URL, by group, all violations) plus a Personas page mapping findings to the
 * real GOV.UK / GDS accessibility persona set. All CSS/JS are inline — the
 * result works from a plain file:// URL, no network access needed. Meant for
 * sharing with non-technical stakeholders; see buildReport() for the
 * Markdown/job-summary equivalent.
 */
export function buildHtmlReport( results: UrlResult[], options: HtmlReportOptions = {} ): string {
	const { title = 'Accessibility report' } = options;
	const agg = aggregate( results );
	return renderReport( title, results, agg );
}
