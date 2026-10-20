import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { gfm } from 'micromark-extension-gfm';
import { directive } from 'micromark-extension-directive';
import type { Extension } from 'micromark-util-types';
import type { Code, Nodes, Root } from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import {
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

/** The repair message for a reply whose blocks failed, or null when every block renders. */
export function richRepairMessage(problems: readonly RichProblem[]): string | null {
	if (!problems.length) return null;
	const lines = problems.flatMap((p) =>
		p.messages.map((m) => `- ${p.block} (line ${p.line}): ${m}`)
	);
	return [
		'Some rich blocks in your last reply are invalid and show as raw code:',
		...lines.slice(0, 20),
		'Your next reply replaces that one, so write the whole reply again with these blocks fixed. Do not mention the fix. If a block cannot be fixed, show that information as a markdown table or list instead.'
	].join('\n');
}
