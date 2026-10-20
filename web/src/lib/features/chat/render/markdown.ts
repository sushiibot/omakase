import type { ContainerDirective } from 'mdast-util-directive';
import type {
	Code,
	Definition,
	Nodes,
	PhrasingContent,
	Root,
	RootContent,
	TableCell,
	TableRow
} from 'mdast';
import { fileUrl, UPLOAD_ID_RE } from '$lib/core/realtime/events';
import type { MdBlock } from '../types';
import {
	formatIssues,
	isContainerName,
	isRichType,
	parseContainerAttrs,
	parsePartialRichBlock,
	parseRichBlock,
	type RichBlock,
	type RichType,
	type Tone
} from './rich/blocks';
import { fenceClosed, parseReplyTree } from './rich/syntax';

// Every security decision about agent text happens here. markdown.svelte only switches on `kind`
// and interpolates strings, so what is validated is exactly what reaches the DOM.

export type MdInlineNode =
	| { kind: 'text'; text: string }
	| { kind: 'strong' | 'em' | 'del'; children: MdInlineNode[] }
	| { kind: 'code'; text: string }
	/** `href` is the parsed URL's serialization, never the source string. */
	| { kind: 'link'; href: string; children: MdInlineNode[] }
	/** `src` is always `/f/<id>` for an inline image the bot attached to this message. */
	| { kind: 'image'; src: string; alt: string }
	| { kind: 'break' };

export type MdAlign = 'left' | 'right' | 'center' | null;

export type MdBlockNode =
	| { kind: 'paragraph'; children: MdInlineNode[] }
	| { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInlineNode[] }
	/** `invalid` names why a rich block's fence fell back to code. */
	| { kind: 'code'; lang: string | null; text: string; invalid?: string[] }
	| { kind: 'quote'; children: MdBlockNode[] }
	| {
			kind: 'list';
			ordered: boolean;
			/** An ordered list inside `:::steps`, drawn as numbered steps. */
			stepper?: boolean;
			/** A task list's identity from its text, so ticks survive a reload. */
			id?: string;
			start: number | null;
			items: { checked: boolean | null; children: MdBlockNode[] }[];
	  }
	| { kind: 'table'; align: MdAlign[]; head: MdInlineNode[][]; rows: MdInlineNode[][][] }
	| { kind: 'rule' }
	/** Unparsed text, shown with its line breaks. */
	| { kind: 'plain'; text: string }
	/** A validated rich block (`breakdown`, `flow`, ...): data only, laid out by its component.
	 *  `partial`: its fence is still streaming and this is what it holds so far (lists may be short
	 *  or empty, cross-field rules not yet checked); the closed fence replaces it. */
	| { kind: 'rich'; block: RichBlock; partial?: true }
	/** A rich block whose fence is still streaming, before anything in it can show: a placeholder. */
	| { kind: 'rich-pending'; type: RichType }
	| { kind: 'callout'; tone: Tone; title: string | null; children: MdBlockNode[] }
	| { kind: 'details'; summary: string; children: MdBlockNode[] }
	/** `href` passed `safeHref`. */
	| {
			kind: 'card';
			title: string | null;
			subtitle: string | null;
			href: string | null;
			children: MdBlockNode[];
	  }
	| { kind: 'columns'; columns: MdBlockNode[][] }
	/** `:::tabs`: each heading starts a tab; anything before the first heading shows above them. */
	| { kind: 'tabs'; intro: MdBlockNode[]; tabs: { label: string; children: MdBlockNode[] }[] };

export interface RenderContext {
	/** Upload ids the bot attached to this same message with `inline: true`; only these render as images. */
	imageIds?: Iterable<string>;
	/** The app's own origin. Links to it render as text, like relative links. */
	origin?: string;
}

/** Nesting past this flattens to plain text, so a hostile reply cannot blow the component stack. */
export const MAX_DEPTH = 12;
/** micromark's emphasis resolution is quadratic on delimiter-heavy input (a 20k-char run of `*`
 *  takes seconds), so longer text renders unparsed rather than freezing the chat. */
export const MARKDOWN_PARSE_MAX = 16_000;
/** Saved documents accept up to 256 KiB; they are parsed once, without streaming. */
export const DOCUMENT_PARSE_MAX = 256 * 1024;
/** Container markers (`>`, list bullets, `1.`) stacked on one line. mdast-util-from-markdown walks
 *  the tree recursively, so a few thousand of them overflow the stack before MAX_DEPTH applies. */
export const CONTAINER_DEPTH_MAX = 32;
/** Emphasis delimiters past this render unparsed: resolving them is quadratic, and a run of 8k `*`
 *  alone takes seconds on a phone. */
export const EMPHASIS_DELIMITER_MAX = 3_000;

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const FILE_PATH_RE = /^\/f\/([A-Za-z0-9_-]{22})$/;

/** The serialized URL when `raw` is an absolute http(s)/mailto URL off this origin; null otherwise. */
export function safeHref(raw: string, origin?: string): string | null {
	// Exact read-only setup route; no query or fragment may carry credentials.
	if (raw === '/connectors/keys') return raw;
	if (/^\/artifacts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw))
		return raw;
	let url: URL;
	try {
		// No base: relative and protocol-relative links fail to parse and render as text.
		url = new URL(raw);
	} catch {
		return null;
	}
	if (!LINK_PROTOCOLS.has(url.protocol)) return null;
	if (url.protocol !== 'mailto:' && origin && sameHost(url, origin)) return null;
	return url.href;
}

// Any scheme or port on the app's own host, including the trailing-dot FQDN form, counts as the app.
function sameHost(url: URL, origin: string): boolean {
	const bare = (host: string) => host.replace(/\.$/, '').toLowerCase();
	try {
		return bare(url.hostname) === bare(new URL(origin).hostname);
	} catch {
		return false;
	}
}

/** `/f/<id>` for a source that names one of the allowed inline uploads exactly; null otherwise. */
export function safeImageSrc(raw: string, imageIds: ReadonlySet<string>): string | null {
	const id = FILE_PATH_RE.exec(raw)?.[1];
	return id && UPLOAD_ID_RE.test(id) && imageIds.has(id) ? fileUrl(id) : null;
}

class Renderer {
	private readonly definitions = new Map<string, Definition>();
	private readonly imageIds: ReadonlySet<string>;
	private readonly origin: string | undefined;

	/** `source` is the text `root` was parsed from; `pending` means it is still streaming. */
	constructor(
		root: Root,
		ctx: RenderContext,
		private readonly source: string,
		private readonly pending = false
	) {
		this.imageIds = new Set(ctx.imageIds ?? []);
		this.origin = ctx.origin;
		const stack: Nodes[] = [root];
		while (stack.length) {
			const node = stack.pop()!;
			if (node.type === 'definition' && !this.definitions.has(node.identifier)) {
				this.definitions.set(node.identifier, node);
			}
			// Reversed, so nodes pop in document order and the first definition of a label wins.
			if ('children' in node)
				for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
		}
	}

	blocks(nodes: readonly RootContent[], depth: number, inContainer = false): MdBlockNode[] {
		return nodes.flatMap((node) => this.block(node, depth, inContainer));
	}

	private block(node: RootContent, depth: number, inContainer: boolean): MdBlockNode[] {
		if (depth > MAX_DEPTH) return [paragraphOf(plainText(node))];
		switch (node.type) {
			case 'containerDirective':
				return this.container(node, depth, inContainer);
			case 'paragraph':
				return [{ kind: 'paragraph', children: this.inlines(node.children, depth + 1) }];
			case 'heading':
				return [
					{ kind: 'heading', level: node.depth, children: this.inlines(node.children, depth + 1) }
				];
			case 'code':
				return [this.code(node)];
			case 'blockquote':
				return [{ kind: 'quote', children: this.blocks(node.children, depth + 1, inContainer) }];
			case 'list':
				return [
					{
						kind: 'list',
						...(node.children.some((item) => typeof item.checked === 'boolean')
							? {
									id: hashText(
										this.source.slice(
											node.position?.start.offset ?? 0,
											node.position?.end.offset ?? 0
										)
									)
								}
							: {}),
						ordered: node.ordered === true,
						start: node.ordered && typeof node.start === 'number' ? node.start : null,
						items: node.children.map((item) => ({
							checked: typeof item.checked === 'boolean' ? item.checked : null,
							children: this.blocks(item.children, depth + 1, inContainer)
						}))
					}
				];
			case 'table': {
				const [head, ...rows] = node.children;
				const cells = (row: TableRow | undefined) =>
					(row?.children ?? []).map((cell: TableCell) => this.inlines(cell.children, depth + 1));
				return [
					{
						kind: 'table',
						align: (node.align ?? []).map((a) => a ?? null),
						head: cells(head),
						rows: rows.map(cells)
					}
				];
			}
			case 'thematicBreak':
				return [{ kind: 'rule' }];
			case 'html':
				return [paragraphOf(node.value)];
			case 'definition':
				return [];
			case 'footnoteDefinition':
				return [
					paragraphOf(`[^${node.label ?? node.identifier}]:`),
					...this.blocks(node.children, depth + 1, inContainer)
				];
			default:
				return [paragraphOf(plainText(node))];
		}
	}

	/** A fence whose language is a rich block type renders as that block when its body validates,
	 *  and as code naming the problem otherwise. The same verdict as the gateway's check. */
	private code(node: Code): MdBlockNode {
		const lang = node.lang ?? null;
		const code: MdBlockNode = { kind: 'code', lang, text: node.value };
		if (!isRichType(lang)) return code;
		if (!fenceClosed(node, this.source)) {
			if (!this.pending) return { ...code, invalid: ['the code fence is not closed'] };
			// The parser drops the body's last line break, which says whether its last line is whole.
			const end = node.position?.end.offset ?? 0;
			const body = this.source[end - 1] === '\n' ? node.value + '\n' : node.value;
			const block = parsePartialRichBlock(lang, body);
			return block
				? { kind: 'rich', block: this.linked(block), partial: true }
				: { kind: 'rich-pending', type: lang };
		}
		const result = parseRichBlock(lang, node.value);
		if (!result.ok) return { ...code, invalid: formatIssues(result.issues) };
		return { kind: 'rich', block: this.linked(result.block) };
	}

	/** Applies the markdown link rule to a block's links; one that fails it is dropped. */
	private linked(block: RichBlock): RichBlock {
		const href = (raw: string | undefined) =>
			raw ? (safeHref(raw, this.origin) ?? undefined) : undefined;
		if (block.type === 'cards') {
			return {
				...block,
				data: { ...block.data, items: block.data.items.map((i) => ({ ...i, href: href(i.href) })) }
			};
		}
		if (block.type === 'place')
			return { ...block, data: { ...block.data, href: href(block.data.href) } };
		return block;
	}

	/** `:::name{attrs}` around markdown. Unknown, nested or invalid containers keep only their content. */
	private container(node: ContainerDirective, depth: number, inContainer: boolean): MdBlockNode[] {
		const children = (nodes: readonly RootContent[]) => this.blocks(nodes, depth + 1, true);
		const name = node.name;
		const attrs =
			isContainerName(name) && !inContainer
				? parseContainerAttrs(name, node.attributes ?? {})
				: null;
		if (!attrs?.ok) return children(node.children);
		const a = attrs.attrs as Record<string, string | undefined>;
		switch (name) {
			case 'callout':
				return [
					{
						kind: 'callout',
						tone: (a.tone as Tone | undefined) ?? 'info',
						title: a.title ?? null,
						children: children(node.children)
					}
				];
			case 'details':
				return [{ kind: 'details', summary: a.summary!, children: children(node.children) }];
			case 'card':
				return [
					{
						kind: 'card',
						title: a.title ?? null,
						subtitle: a.subtitle ?? null,
						href: a.href ? safeHref(a.href, this.origin) : null,
						children: children(node.children)
					}
				];
			case 'columns': {
				const columns: RootContent[][] = [[]];
				for (const child of node.children) {
					if (child.type === 'thematicBreak') columns.push([]);
					else columns.at(-1)!.push(child);
				}
				return [
					{
						kind: 'columns',
						columns: columns
							.filter((c) => c.length)
							.slice(0, 4)
							.map(children)
					}
				];
			}
			case 'tabs': {
				const intro: RootContent[] = [];
				const tabs: { label: string; nodes: RootContent[] }[] = [];
				for (const child of node.children) {
					if (child.type === 'heading')
						tabs.push({ label: plainText(child).trim() || `Tab ${tabs.length + 1}`, nodes: [] });
					else (tabs.at(-1)?.nodes ?? intro).push(child);
				}
				if (tabs.length < 2) return children(node.children);
				return [
					{
						kind: 'tabs',
						intro: children(intro),
						tabs: tabs
							.slice(0, 6)
							.map((t) => ({ label: t.label.slice(0, 40), children: children(t.nodes) }))
					}
				];
			}
			case 'steps':
				return children(node.children).map((b) =>
					b.kind === 'list' && b.ordered ? { ...b, stepper: true } : b
				);
		}
		return children(node.children);
	}

	inlines(nodes: readonly PhrasingContent[], depth: number): MdInlineNode[] {
		const out: MdInlineNode[] = [];
		for (const node of nodes) {
			for (const inline of this.inline(node, depth)) {
				const last = out.at(-1);
				if (inline.kind === 'text' && last?.kind === 'text') last.text += inline.text;
				else out.push(inline);
			}
		}
		return out;
	}

	private inline(node: PhrasingContent, depth: number): MdInlineNode[] {
		if (depth > MAX_DEPTH) return [{ kind: 'text', text: plainText(node) }];
		switch (node.type) {
			case 'text':
				return [{ kind: 'text', text: node.value }];
			case 'strong':
			case 'emphasis':
			case 'delete':
				return [
					{
						kind: node.type === 'strong' ? 'strong' : node.type === 'emphasis' ? 'em' : 'del',
						children: this.inlines(node.children, depth + 1)
					}
				];
			case 'inlineCode':
				return [{ kind: 'code', text: node.value }];
			case 'break':
				return [{ kind: 'break' }];
			case 'html':
				return [{ kind: 'text', text: node.value }];
			case 'link':
				return this.link(node.url, node.children, depth);
			case 'linkReference': {
				const def = this.definitions.get(node.identifier);
				return def
					? this.link(def.url, node.children, depth)
					: this.inlines(node.children, depth + 1);
			}
			case 'image':
				return this.image(node.url, node.alt ?? '', depth);
			case 'imageReference': {
				const def = this.definitions.get(node.identifier);
				return def
					? this.image(def.url, node.alt ?? '', depth)
					: [{ kind: 'text', text: node.alt ?? '' }];
			}
			case 'footnoteReference':
				return [{ kind: 'text', text: `[^${node.label ?? node.identifier}]` }];
			default:
				return [{ kind: 'text', text: plainText(node) }];
		}
	}

	private link(url: string, children: PhrasingContent[], depth: number): MdInlineNode[] {
		const inner = this.inlines(children, depth + 1);
		const href = safeHref(url, this.origin);
		// A link inside a link is invalid HTML; the outer one wins and the inner renders as its text.
		return href ? [{ kind: 'link', href, children: stripLinks(inner) }] : inner;
	}

	private image(url: string, alt: string, depth: number): MdInlineNode[] {
		const src = safeImageSrc(url, this.imageIds);
		if (src) return [{ kind: 'image', src, alt }];
		const label: PhrasingContent[] = [{ type: 'text', value: alt || url }];
		return this.link(url, label, depth);
	}
}

/** FNV-1a, as 8 hex digits: a stable id for a piece of text. */
export function hashText(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

function containsDefinition(node: Nodes): boolean {
	const stack: Nodes[] = [node];
	while (stack.length) {
		const n = stack.pop()!;
		if (n.type === 'definition' || n.type === 'footnoteDefinition') return true;
		if ('children' in n) stack.push(...n.children);
	}
	return false;
}

function paragraphOf(text: string): MdBlockNode {
	return { kind: 'paragraph', children: [{ kind: 'text', text }] };
}

function stripLinks(nodes: MdInlineNode[]): MdInlineNode[] {
	return nodes.flatMap((n): MdInlineNode[] => {
		if (n.kind === 'link') return stripLinks(n.children);
		if (n.kind === 'strong' || n.kind === 'em' || n.kind === 'del') {
			return [{ kind: n.kind, children: stripLinks(n.children) }];
		}
		return [n];
	});
}

/** Iterative so an adversarially deep tree cannot overflow the stack here either. */
function plainText(node: Nodes): string {
	const parts: string[] = [];
	const stack: Nodes[] = [node];
	while (stack.length) {
		const n = stack.pop()!;
		if ('value' in n && typeof n.value === 'string') parts.push(n.value);
		else if (n.type === 'image' || n.type === 'imageReference') parts.push(n.alt ?? '');
		else if (n.type === 'break') parts.push('\n');
		if ('children' in n) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
	}
	return parts.join('');
}

const isDigit = (c: number) => c >= 48 && c <= 57;
const isBlank = (c: number) => c === 32 || c === 9 || Number.isNaN(c);

/** True when some line opens more than `max` containers. A linear scan with no regex, so a
 *  16k-char line cannot backtrack; over-counting only costs formatting. */
export function containerDepthExceeds(text: string, max = CONTAINER_DEPTH_MAX): boolean {
	let depth = 0;
	let atLineStart = true;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 10 || c === 13) {
			depth = 0;
			atLineStart = true;
			continue;
		}
		if (!atLineStart || c === 32 || c === 9) continue;
		if (c === 62 /* > */) {
			depth++;
		} else if ((c === 45 || c === 42 || c === 43) /* - * + */ && isBlank(text.charCodeAt(i + 1))) {
			depth++;
		} else if (isDigit(c)) {
			let j = i;
			while (j - i < 10 && isDigit(text.charCodeAt(j))) j++;
			const d = text.charCodeAt(j);
			if ((d === 46 || d === 41) /* . ) */ && isBlank(text.charCodeAt(j + 1))) {
				depth++;
				i = j;
			} else atLineStart = false;
		} else {
			atLineStart = false;
		}
		if (depth > max) return true;
	}
	return false;
}

/** Counts `*` and every `_` that is not intraword, the only underscores that can open or close. */
export function emphasisDelimiters(text: string): number {
	let n = 0;
	// `_` itself is not a word character here, so a long run of underscores still counts.
	const word = (c: number) =>
		isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c > 127;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 42) n++;
		else if (c === 95 && !(word(text.charCodeAt(i - 1)) && word(text.charCodeAt(i + 1)))) n++;
	}
	return n;
}

/** True when `text` must render unparsed: too long, too deeply nested, or too many delimiters. */
export function exceedsParseLimits(text: string, maxLength = MARKDOWN_PARSE_MAX): boolean {
	return (
		text.length > maxLength ||
		containerDepthExceeds(text) ||
		emphasisDelimiters(text) > EMPHASIS_DELIMITER_MAX
	);
}

const parseRoot = parseReplyTree;

/** Parses agent markdown (CommonMark + GFM) to a render tree. Raw HTML is kept as literal text.
 *  Never throws: input the parser can't handle safely comes back as one plain-text block. */
export function parseMarkdown(text: string, ctx: RenderContext = {}): MdBlockNode[] {
	return parseWithinLimits(text, ctx, MARKDOWN_PARSE_MAX);
}

/** Document-sized input, with the same complexity limits and safe rendering rules as chat. */
export function parseDocumentMarkdown(text: string, ctx: RenderContext = {}): MdBlockNode[] {
	return parseWithinLimits(text, ctx, DOCUMENT_PARSE_MAX);
}

function parseWithinLimits(text: string, ctx: RenderContext, maxLength: number): MdBlockNode[] {
	const plain: MdBlockNode[] = [{ kind: 'plain', text }];
	if (exceedsParseLimits(text, maxLength)) return plain;
	try {
		const root = parseRoot(text);
		return new Renderer(root, ctx, text).blocks(root.children, 0);
	} catch {
		return plain;
	}
}

/** One top-level markdown node: its source span and its render blocks. */
export interface TopLevelBlock {
	start: number;
	end: number;
	blocks: MdBlockNode[];
	/** Holds a link or footnote definition at any depth, which can change text before it. */
	definition: boolean;
}

/** Each top-level node of `text` with its source offsets, or null when the parser throws.
 *  Skips the limit checks: the caller runs them on the whole message. */
export function parseTopLevel(text: string, ctx: RenderContext = {}): TopLevelBlock[] | null {
	try {
		const root = parseRoot(text);
		// Only the stream parses top-level nodes, so an open rich fence here is still being typed.
		const renderer = new Renderer(root, ctx, text, true);
		return root.children.map((node) => ({
			start: node.position?.start.offset ?? 0,
			end: node.position?.end.offset ?? text.length,
			blocks: renderer.blocks([node], 0),
			definition: containsDefinition(node)
		}));
	} catch {
		return null;
	}
}

/** The prototype blocks' text, for when rendering them fails. */
export function legacyPlainText(blocks: readonly MdBlock[]): string {
	return blocks
		.map((b) => (b.kind === 'heading' ? b.text : b.inlines.map((i) => i.text).join('')))
		.join('\n\n');
}

/** Converts the prototype's pre-parsed blocks, applying the same link rule. */
export function fromLegacyBlocks(
	blocks: readonly MdBlock[],
	ctx: RenderContext = {}
): MdBlockNode[] {
	return blocks.map((block): MdBlockNode => {
		if (block.kind === 'heading') {
			return { kind: 'heading', level: 3, children: [{ kind: 'text', text: block.text }] };
		}
		return {
			kind: 'paragraph',
			children: block.inlines.map((inline): MdInlineNode => {
				if (inline.kind === 'strong') {
					return { kind: 'strong', children: [{ kind: 'text', text: inline.text }] };
				}
				if (inline.kind === 'code') return { kind: 'code', text: inline.text };
				if (inline.kind === 'link') {
					const href = safeHref(inline.href, ctx.origin);
					return href
						? { kind: 'link', href, children: [{ kind: 'text', text: inline.text }] }
						: { kind: 'text', text: inline.text };
				}
				return { kind: 'text', text: inline.text };
			})
		};
	});
}
