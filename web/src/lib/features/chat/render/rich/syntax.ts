import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { gfm } from 'micromark-extension-gfm';
import { directive } from 'micromark-extension-directive';
import type { Extension } from 'micromark-util-types';
import type { Code, Nodes, Root, RootContent } from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import {
	RICH_SCHEMAS,
	formatIssues,
	isContainerName,
	isRichType,
	parseContainerAttrs,
	parseRichBlock,
	CONTAINER_NAMES
} from './blocks';

/** Only `:::name` containers. Text (`:name`) and leaf (`::name`) directives stay off: they would
 *  claim ordinary prose like `re:thing` or `mailto:me@x.y`. */
function containerDirectives(): Extension {
	const flow = directive().flow?.[58];
	return { flow: { 58: Array.isArray(flow) ? flow[0] : flow! } };
}

/** The one markdown parser for agent replies, used by the web renderer and the gateway's check. */
export function parseReplyTree(text: string): Root {
	return fromMarkdown(text, {
		extensions: [gfm(), containerDirectives()],
		mdastExtensions: [gfmFromMarkdown(), directiveFromMarkdown()]
	});
}

/** True when the fence was closed in the source, not ended by the end of the text. */
export function fenceClosed(node: Code, source: string): boolean {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	if (start === undefined || end === undefined) return true;
	const lines = source.slice(start, end).split('\n');
	if (lines.length < 2) return false;
	const open = /^\s*(`{3,}|~{3,})/.exec(lines[0])?.[1];
	const last = lines.at(-1)!.trim();
	return !!open && last.length >= open.length && [...last].every((c) => c === open[0]);
}

export interface RichProblem {
	/** 1-based line of the block's opening fence or `:::`. */
	line: number;
	/** `breakdown`, or `:::callout`. */
	block: string;
	messages: string[];
}

/** Every rich block in a reply that will not render, with the reason. Deterministic; the gateway
 *  sends these back to the model, and the renderer reaches the same verdict for each block. */
export function lintRichMarkdown(text: string): RichProblem[] {
	let root: Root;
	try {
		root = parseReplyTree(text);
	} catch {
		return [];
	}
	const problems: RichProblem[] = [];
	const visit = (node: Nodes, inContainer: boolean) => {
		if (node.type === 'code' && isRichType(node.lang)) {
			const line = node.position?.start.line ?? 1;
			if (!fenceClosed(node, text)) {
				problems.push({ line, block: node.lang, messages: ['the code fence is not closed'] });
				return;
			}
			const result = parseRichBlock(node.lang, node.value);
			if (!result.ok)
				problems.push({ line, block: node.lang, messages: formatIssues(result.issues) });
			return;
		}
		if (node.type === 'containerDirective') {
			const line = node.position?.start.line ?? 1;
			const block = `:::${node.name}`;
			if (inContainer)
				problems.push({
					line,
					block,
					messages: ['containers cannot be nested; close the outer one first']
				});
			else if (!isContainerName(node.name)) {
				problems.push({
					line,
					block,
					messages: [`unknown container (known: ${CONTAINER_NAMES.join(', ')})`]
				});
			} else {
				const attrs = parseContainerAttrs(node.name, (node as ContainerDirective).attributes ?? {});
				if (!attrs.ok) problems.push({ line, block, messages: formatIssues(attrs.issues) });
				if (node.name === 'tabs' && node.children.filter((c) => c.type === 'heading').length < 2) {
					problems.push({
						line,
						block,
						messages: ['start each tab with a ## heading (at least 2 tabs)']
					});
				}
				if (node.name === 'steps' && !node.children.some((c) => c.type === 'list' && c.ordered)) {
					problems.push({
						line,
						block,
						messages: ['write the steps as an ordered list (1. 2. 3.)']
					});
				}
			}
			for (const child of node.children) visit(child, true);
			return;
		}
		if ('children' in node) for (const child of node.children) visit(child as Nodes, inContainer);
	};
	visit(root, false);
	return problems;
}

const INGREDIENTS = /^\W*ingredients\b/i;
const METHOD = /^\W*(?:instructions|directions|method|steps|preparation|how to make)\b/i;

function toText(node: Nodes): string {
	if ('value' in node && typeof node.value === 'string') return node.value;
	return 'children' in node ? node.children.map((c) => toText(c as Nodes)).join('') : '';
}

/** A label line: a heading, or a short paragraph that is only bold text or ends with a colon. */
function labelText(node: RootContent): string | null {
	if (node.type === 'heading') return toText(node);
	if (node.type !== 'paragraph') return null;
	const text = toText(node).trim();
	const onlyStrong = node.children.length === 1 && node.children[0].type === 'strong';
	return onlyStrong || (text.endsWith(':') && text.length <= 40) ? text : null;
}

/** Required blocks a reply wrote as markdown instead. Only unambiguous shapes: a recipe is an
 *  "Ingredients" label over a list plus a method label over a list. Deterministic. */
export function missedBlocks(text: string): string[] {
	let root: Root;
	try {
		root = parseReplyTree(text);
	} catch {
		return [];
	}
	let hasRecipe = false;
	const visit = (n: Nodes) => {
		if (n.type === 'code' && n.lang === 'recipe') hasRecipe = true;
		if ('children' in n) for (const c of n.children) visit(c as Nodes);
	};
	visit(root);
	if (hasRecipe) return [];
	const listAfter = (re: RegExp) =>
		root.children.some((node, i) => {
			const label = labelText(node);
			return label !== null && re.test(label) && root.children[i + 1]?.type === 'list';
		});
	return listAfter(INGREDIENTS) && listAfter(METHOD) ? ['recipe'] : [];
}

/** The repair message for a reply whose blocks failed or that wrote a required block as markdown,
 *  or null when there is nothing to fix. */
export function richRepairMessage(
	problems: readonly RichProblem[],
	missed: readonly string[] = []
): string | null {
	if (!problems.length && !missed.length) return null;
	const lines = problems.flatMap((p) =>
		p.messages.map((m) => `- ${p.block} (line ${p.line}): ${m}`)
	);
	return [
		...missed.map(
			(type) =>
				`Your last reply wrote a ${type} as markdown. It must be a \`\`\`${type} block with a YAML body. Fields: ${RICH_SCHEMAS[type as keyof typeof RICH_SCHEMAS].doc()}`
		),
		...(lines.length
			? ['Some rich blocks in your last reply are invalid and show as raw code:']
			: []),
		...lines.slice(0, 20),
		'Your next reply replaces that one, so write the whole reply again with this fixed. Do not mention the fix. If a block cannot be fixed, show that information as a markdown table or list instead.'
	].join('\n');
}
