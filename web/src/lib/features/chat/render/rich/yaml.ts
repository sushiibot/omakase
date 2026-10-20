import { isAlias, isNode, parseDocument, visit } from 'yaml';
import type { Issue } from './schema';

/** A rich block's body may not be larger than this; it is a chart spec, not a document. */
export const RICH_BODY_MAX = 8 * 1024;
/** Nesting past this is rejected before validation, so a hostile body can't recurse deeply. */
export const RICH_DEPTH_MAX = 8;

/**
 * Parses a block body as plain data. Only the JSON-compatible core schema: no tags (`!!binary`,
 * `!js/function`), no anchors or aliases (no exponential expansion), no merge keys, no duplicate
 * keys. Deterministic; never throws.
 */
export function parseRichYaml(
	text: string
): { ok: true; value: unknown } | { ok: false; issues: Issue[] } {
	if (text.length > RICH_BODY_MAX) {
		return {
			ok: false,
			issues: [
				{ path: '', message: `body too large (${text.length} > ${RICH_BODY_MAX} characters)` }
			]
		};
	}
	let doc;
	try {
		doc = parseDocument(text, {
			schema: 'core',
			merge: false,
			uniqueKeys: true,
			strict: true,
			prettyErrors: true,
			customTags: [],
			resolveKnownTags: false
		});
	} catch (err) {
		return {
			ok: false,
			issues: [{ path: '', message: `YAML: ${(err as Error).message.split('\n')[0]}` }]
		};
	}
	const problems = [...doc.errors, ...doc.warnings];
	if (problems.length) {
		return {
			ok: false,
			issues: problems
				.slice(0, 3)
				.map((e) => ({ path: '', message: `YAML: ${e.message.split('\n')[0]}` }))
		};
	}
	const issues: Issue[] = [];
	visit(doc, {
		Node(_, node) {
			if (isAlias(node))
				issues.push({ path: '', message: 'YAML: aliases (*name) are not allowed' });
			else if (isNode(node) && node.anchor)
				issues.push({ path: '', message: 'YAML: anchors (&name) are not allowed' });
			else if (isNode(node) && node.tag)
				issues.push({ path: '', message: `YAML: tags (${node.tag}) are not allowed` });
			return issues.length ? visit.BREAK : undefined;
		}
	});
	if (issues.length) return { ok: false, issues };
	let value: unknown;
	try {
		value = doc.toJS({ maxAliasCount: 0 });
	} catch (err) {
		return {
			ok: false,
			issues: [{ path: '', message: `YAML: ${(err as Error).message.split('\n')[0]}` }]
		};
	}
	if (depthOf(value) > RICH_DEPTH_MAX) {
		return {
			ok: false,
			issues: [{ path: '', message: `nested more than ${RICH_DEPTH_MAX} levels deep` }]
		};
	}
	return { ok: true, value };
}

function depthOf(value: unknown): number {
	let max = 0;
	const stack: [unknown, number][] = [[value, 0]];
	while (stack.length) {
		const [v, d] = stack.pop()!;
		if (d > max) max = d;
		if (d > RICH_DEPTH_MAX) return d;
		if (v && typeof v === 'object')
			for (const child of Object.values(v)) stack.push([child, d + 1]);
	}
	return max;
}
