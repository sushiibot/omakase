<script lang="ts">
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import { BitsConfig } from 'bits-ui';
	import X from '@lucide/svelte/icons/x';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Settings from '@lucide/svelte/icons/settings';
	import { setDrawer } from './drawer';
	import { setWorkspace, type WorkspaceInspector } from '../workspace/context';
	import {
		clampOffset,
		horizontalIntent,
		motion,
		offsetFor,
		releasePane,
		type Pane
	} from '../workspace/pane-motion';
	import type { NavItem } from './types';

	let {
		nav,
		active,
		navigationKey,
		home = 'chat',
		badges = {},
		onhome,
		navigation,
		navigationOpen = false,
		onopenNavigation,
		oncloseNavigation,
		onnavigate,
		conversation = false,
		children
	}: {
		nav: NavItem[];
		active?: string;
		navigationKey?: string;
		home?: string;
		badges?: Record<string, number | boolean | undefined>;
		onhome?: (e: MouseEvent) => void;
		navigation?: Snippet;
		navigationOpen?: boolean;
		onopenNavigation?: () => void;
		oncloseNavigation?: () => void;
		onnavigate?: (href: string) => void;
		conversation?: boolean;
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const sheets = `${uid}-sheets`;
	let root: HTMLElement;
	let width = $state(412);
	let standaloneOpen = $state(false);
	let inspector = $state.raw<WorkspaceInspector | null>(null);
	let drag = $state<number | null>(null);
	let focusBefore: HTMLElement | null = null;
	let previous: Pane = 'chat';
	const wide = $derived(width >= 1100);
	const navOpen = $derived(onopenNavigation ? navigationOpen : standaloneOpen);
	const pane = $derived<Pane>(navOpen ? 'navigation' : inspector?.open ? 'inspector' : 'chat');
	const navWidth = $derived(Math.min(320, width - 56));
	const inspectorWidth = $derived(inspector ? Math.min(360, width - 48) : 0);
	const offset = $derived(wide ? 0 : (drag ?? offsetFor(pane, navWidth, inspectorWidth)));
	const navigationActive = $derived(wide || pane === 'navigation');
	const inspectorActive = $derived(!!inspector && pane === 'inspector');
	const navigationShown = $derived(navigationActive || (drag !== null && drag > 0));
	const inspectorShown = $derived(inspectorActive || (drag !== null && drag < 0));
	const footerNav = $derived(nav.filter((item) => item.id !== home && item.id !== 'settings'));
	const badgeTotal = $derived(
		Object.values(badges).reduce<number>(
			(n, value) => n + (typeof value === 'number' ? value : value ? 1 : 0),
			0
		)
	);

	setWorkspace({
		get contentVisible() {
			return wide || pane === 'chat';
		},
		registerInspector(next) {
			inspector = next;
			return () => {
				if (inspector === next) inspector = null;
			};
		}
	});
	setDrawer({
		open() {
			openNavigation();
		},
		get badge() {
			return badgeTotal;
		},
		get persistent() {
			return wide;
		},
		get channels() {
			return !!navigation;
		}
	});

	function openNavigation() {
		focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		if (onopenNavigation) onopenNavigation();
		else standaloneOpen = true;
	}
	function closePane() {
		if (navOpen) {
			if (oncloseNavigation) oncloseNavigation();
			else standaloneOpen = false;
		} else inspector?.onclose();
	}
	function navigationClick(e: MouseEvent) {
		if (
			!navOpen ||
			e.defaultPrevented ||
			e.button !== 0 ||
			e.metaKey ||
			e.ctrlKey ||
			e.shiftKey ||
			e.altKey
		)
			return;
		const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
		if (!link) return;
		const href = new URL(link.getAttribute('href')!, location.href);
		if (href.pathname === location.pathname && href.search === location.search) {
			e.preventDefault();
			closePane();
		} else if (onnavigate && href.origin === location.origin) {
			e.preventDefault();
			onnavigate(href.pathname + href.search + href.hash);
		}
	}
	function select(next: Pane) {
		if (next === pane) return;
		if (next === 'navigation') openNavigation();
		else if (next === 'inspector') inspector?.onopen();
		else closePane();
	}

	let gesture: {
		id: number;
		x: number;
		y: number;
		base: number;
		lastX: number;
		at: number;
		velocity: number;
		horizontal: boolean;
	} | null = null;
	function recover() {
		gesture = null;
		drag = null;
	}
	const excluded =
		'a,button,input,textarea,select,summary,pre,code,[contenteditable],[role="slider"],[role="tab"],[data-tab-pager]';
	function down(e: PointerEvent) {
		if (
			wide ||
			!e.isPrimary ||
			e.button !== 0 ||
			e.pointerType === 'mouse' ||
			(!conversation && pane === 'chat')
		)
			return;
		const target = e.target;
		if (
			!(target instanceof HTMLElement) ||
			target.closest(excluded) ||
			document.getSelection()?.isCollapsed === false
		)
			return;
		if (
			root.querySelector(
				'[data-routed-sheet][data-state="open"],dialog[open],[data-slot="sheet-content"][data-state="open"]'
			)
		)
			return;
		const rect = root.getBoundingClientRect();
		if (e.clientX - rect.left < motion.edge || rect.right - e.clientX < motion.edge) return;
		for (let el: HTMLElement | null = target; el && el !== root; el = el.parentElement) {
			if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX))
				return;
		}
		gesture = {
			id: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			base: offset,
			lastX: e.clientX,
			at: performance.now(),
			velocity: 0,
			horizontal: false
		};
	}
	function move(e: PointerEvent) {
		if (gesture?.id !== e.pointerId) return;
		const dx = e.clientX - gesture.x,
			dy = e.clientY - gesture.y;
		if (document.getSelection()?.isCollapsed === false) return recover();
		if (!gesture.horizontal) {
			if (Math.abs(dy) > motion.intent && Math.abs(dy) > Math.abs(dx)) return recover();
			if (!horizontalIntent(dx, dy)) return;
			gesture.horizontal = true;
			root.setPointerCapture(e.pointerId);
		}
		const at = performance.now(),
			elapsed = at - gesture.at;
		if (elapsed > 0) gesture.velocity = (e.clientX - gesture.lastX) / elapsed;
		gesture.lastX = e.clientX;
		gesture.at = at;
		drag = clampOffset(gesture.base + dx, navWidth, inspectorWidth);
	}
	function up(e: PointerEvent) {
		if (gesture?.id !== e.pointerId) return;
		const next =
			drag !== null && gesture.horizontal
				? releasePane(
						drag,
						performance.now() - gesture.at > 80 ? 0 : gesture.velocity,
						navWidth,
						inspectorWidth
					)
				: pane;
		if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
		gesture = null;
		drag = null;
		select(next);
	}
	function keys(e: KeyboardEvent) {
		if (e.defaultPrevented) return;
		if (pane === 'chat') return;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			closePane();
		}
		if (e.key !== 'Tab' || wide) return;
		const area = root.querySelector<HTMLElement>(
			pane === 'navigation' ? '[data-channel-navigation]' : '[data-workspace-inspector]'
		);
		const items = area
			? [
					...area.querySelectorAll<HTMLElement>(
						'a[href],button:not(:disabled),input:not(:disabled),textarea,[tabindex="0"]'
					)
				].filter((el) => el.getClientRects().length)
			: [];
		const first = items[0],
			last = items.at(-1);
		if (e.shiftKey && (document.activeElement === first || document.activeElement === area)) {
			e.preventDefault();
			last?.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first?.focus();
		}
	}

	onMount(() => {
		width = root.clientWidth;
		let measuredWidth = width,
			measuredHeight = root.clientHeight;
		const resize = new ResizeObserver(() => {
			if (root.clientWidth !== measuredWidth || root.clientHeight !== measuredHeight) recover();
			measuredWidth = root.clientWidth;
			measuredHeight = root.clientHeight;
			width = measuredWidth;
		});
		resize.observe(root);
		const visibility = () => {
			if (document.hidden) recover();
		};
		addEventListener('blur', recover);
		document.addEventListener('visibilitychange', visibility);
		return () => {
			resize.disconnect();
			removeEventListener('blur', recover);
			document.removeEventListener('visibilitychange', visibility);
		};
	});
	$effect(() => {
		if (wide && navOpen) untrack(closePane);
	});
	$effect(() => {
		void navigationKey;
		recover();
		if (!onopenNavigation) standaloneOpen = false;
	});
	$effect(() => {
		const next = pane;
		if (next === previous) return;
		const prior = previous;
		previous = next;
		if (next !== 'chat' && prior === 'chat')
			focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		if (!root) return;
		void tick().then(() =>
			requestAnimationFrame(() => {
				if (next === 'chat') {
					if (focusBefore?.isConnected && !focusBefore.closest('[inert]'))
						focusBefore.focus({ preventScroll: true });
				} else if (!wide)
					root
						.querySelector<HTMLElement>(
							next === 'navigation' ? '[data-channel-navigation]' : '[data-workspace-inspector]'
						)
						?.focus({ preventScroll: true });
			})
		);
	});
</script>

<svelte:window onkeydown={keys} />

{#snippet badge(id: string)}
	{@const value = badges[id]}
	{#if typeof value === 'number' && value > 0}<span
			class="rounded-full bg-waiting-soft px-1.5 text-meta font-semibold text-waiting tabular-nums"
			>{value}<span class="sr-only"> need you</span></span
		>
	{:else if value === true}<span class="size-2 rounded-full bg-brand"
			><span class="sr-only">Unread</span></span
		>{/if}
{/snippet}
{#snippet navBody()}
	<div class="workspace-header flex items-center gap-2 px-4">
		<img src="/brand/mark.png" alt="" width="32" height="20" class="h-5 w-8 object-contain" />
		<span class="flex-1 text-ui font-semibold">sushii</span>
		{#if wide}<a
				href="/settings"
				aria-label="Settings"
				class="grid size-12 place-items-center rounded-md hover:bg-sidebar-accent"
				><Settings class="size-4" /></a
			>
		{:else}<a
				href="/settings"
				aria-label="Settings"
				data-sveltekit-replacestate={navOpen ? '' : undefined}
				class="grid size-12 place-items-center rounded-md hover:bg-sidebar-accent"
				><Settings class="size-4" /></a
			><button
				aria-label="Close channels"
				class="grid size-12 place-items-center rounded-md hover:bg-sidebar-accent"
				onclick={closePane}><X class="size-5" /></button
			>{/if}
	</div>
	{#if navigation}{@render navigation()}
	{:else}<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
			{#each nav as item (item.id)}<a
					href={item.href}
					aria-current={active === item.id ? 'page' : undefined}
					onclick={(e) => {
						if (item.id === home) onhome?.(e);
						if (!onopenNavigation) standaloneOpen = false;
					}}
					class="flex min-h-12 items-center gap-2 rounded-md px-2 text-ui hover:bg-sidebar-accent"
					><item.icon class="size-4" />{item.label}{@render badge(item.id)}</a
				>{/each}
		</div>{/if}
	{#if navigation}<nav aria-label="Workspace" class="grid grid-cols-3 gap-2 border-t p-2">
			{#each footerNav as item (item.id)}<a
					href={item.href}
					data-sveltekit-replacestate={navOpen ? '' : undefined}
					aria-current={active === item.id ? 'page' : undefined}
					class="flex min-h-12 flex-col items-center justify-center gap-1 rounded-md text-meta text-muted-foreground hover:bg-sidebar-accent aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-foreground"
					><item.icon class="size-4" />{item.label}{@render badge(item.id)}</a
				>{/each}
		</nav>{/if}
{/snippet}

<BitsConfig defaultPortalTo={`#${sheets}`}>
	<div
		bind:this={root}
		role="group"
		aria-label="Channel workspace"
		data-shell
		data-workspace-pane={pane}
		class="workspace group/shell @container relative h-[calc(100%-var(--kb))] overflow-hidden bg-background pt-(--safe-top) text-foreground"
		class:wide
		class:dragging={drag !== null}
		style:--nav-width={`${navWidth}px`}
		style:--inspector-width={`${inspectorWidth}px`}
		style:--chat-offset={`${offset}px`}
		style:--inspector-column={inspectorActive ? '320px' : '0px'}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={recover}
		onlostpointercapture={(e) => {
			if (e.target === root && gesture && !root.hasPointerCapture(e.pointerId)) recover();
		}}
	>
		<div
			data-channel-navigation
			role={wide ? 'navigation' : 'dialog'}
			aria-label={wide ? 'Channel navigation' : 'Menu'}
			aria-modal={!wide && navOpen ? true : undefined}
			tabindex="-1"
			class="navigation"
			class:exposed={navigationShown}
			inert={!navigationActive}
			aria-hidden={!navigationActive}
			onclick={navigationClick}
		>
			{@render navBody()}
		</div>
		{#if inspector}<aside
				data-workspace-inspector
				aria-label="Conversation tasks"
				tabindex="-1"
				class="inspector"
				class:exposed={inspectorShown}
				inert={!inspectorActive}
				aria-hidden={!inspectorActive}
			>
				{@render inspector.content()}
			</aside>{/if}
		<div class="chat-surface" data-chat-surface>
			<div
				class="chat-content flex h-full min-h-0 min-w-0 flex-col"
				inert={!wide && pane !== 'chat'}
				aria-hidden={!wide && pane !== 'chat' ? true : undefined}
			>
				{@render children()}
			</div>
			{#if !wide && pane !== 'chat'}<button
					class="return-to-chat"
					class:inspector-return={pane === 'inspector'}
					aria-label="Return to conversation"
					onclick={closePane}><ArrowLeft class="size-5" /></button
				>{/if}
		</div>
		<div id={sheets}></div>
	</div>
</BitsConfig>

<style>
	.workspace {
		isolation: isolate;
		touch-action: pan-y pinch-zoom;
	}
	.workspace-header {
		min-height: 56px;
		flex-shrink: 0;
		border-bottom: 1px solid var(--border);
	}
	.navigation,
	.inspector {
		position: absolute;
		inset-block: 0;
		display: flex;
		flex-direction: column;
		background: var(--sidebar);
		outline: none;
	}
	.navigation {
		left: 0;
		width: var(--nav-width);
		padding-top: var(--safe-top);
		padding-bottom: var(--safe-bottom);
	}
	.inspector {
		right: 0;
		width: var(--inspector-width);
		padding-top: var(--safe-top);
	}
	.navigation:not(.exposed),
	.inspector:not(.exposed) {
		visibility: hidden;
	}
	.chat-surface {
		position: absolute;
		inset: 0;
		z-index: 1;
		background: var(--background);
		transform: translateX(var(--chat-offset));
		transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
		padding-top: var(--safe-top);
	}
	.dragging .chat-surface {
		transition: none;
		user-select: none;
	}
	.return-to-chat {
		position: absolute;
		inset: 0;
		width: 100%;
		display: flex;
		align-items: center;
		padding: 16px;
		background: color-mix(in oklab, var(--foreground) 5%, transparent);
	}
	.inspector-return {
		justify-content: flex-end;
	}
	.inspector-return :global(svg) {
		transform: rotate(180deg);
	}
	.workspace :global(main),
	.navigation {
		touch-action: pan-y pinch-zoom;
	}
	.wide {
		display: grid;
		grid-template-columns: 256px minmax(0, 1fr) var(--inspector-column);
	}
	.wide .navigation,
	.wide .inspector,
	.wide .chat-surface {
		position: relative;
		inset: auto;
		width: auto;
		transform: none;
		min-height: 0;
		padding-top: 0;
	}
	.wide .navigation {
		grid-column: 1;
		grid-row: 1;
		border-right: 1px solid var(--border);
	}
	.wide .chat-surface {
		grid-column: 2;
		grid-row: 1;
		min-width: 0;
	}
	.wide .inspector {
		grid-column: 3;
		grid-row: 1;
		min-width: 0;
		overflow: hidden;
		border-left: 1px solid var(--border);
	}
	@media (prefers-reduced-motion: reduce) {
		.chat-surface {
			transition: none;
		}
	}
</style>
