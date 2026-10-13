<!-- modeled on shadcn-svelte sidebar-15: left sidebar, inset, right sidebar; phones keep the gesture panes -->
<script lang="ts">
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { BitsConfig } from 'bits-ui';
	import X from '@lucide/svelte/icons/x';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Settings from '@lucide/svelte/icons/settings';
	import * as Sidebar from '$lib/ui/sidebar';
	import { SIDEBAR_COOKIE_NAME } from '$lib/ui/sidebar/constants';
	import { Button } from '$lib/ui/button';
	import { MOBILE_BREAKPOINT, INSPECTOR_BREAKPOINT } from '$lib/ui/breakpoints';
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
	// min-width, like Tailwind's md:, so a fractional width at zoom never falls between the two.
	const navQuery = new MediaQuery(`min-width: ${MOBILE_BREAKPOINT}px`);
	const inspectorQuery = new MediaQuery(`min-width: ${INSPECTOR_BREAKPOINT}px`);
	let frame = $state<HTMLElement | null>(null);
	let root: HTMLElement;
	let width = $state(412);
	let sidebarOpen = $state(
		typeof document === 'undefined' ||
			!new RegExp(`(?:^|;\\s*)${SIDEBAR_COOKIE_NAME}=false`).test(document.cookie)
	);
	let standaloneOpen = $state(false);
	let inspector = $state.raw<WorkspaceInspector | null>(null);
	let drag = $state<number | null>(null);
	let focusBefore: HTMLElement | null = null;
	let previous: Pane = 'chat';
	const navDocked = $derived(navQuery.current);
	const inspectorDocked = $derived(inspectorQuery.current);
	const navOpen = $derived(onopenNavigation ? navigationOpen : standaloneOpen);
	const pane = $derived<Pane>(navOpen ? 'navigation' : inspector?.open ? 'inspector' : 'chat');
	const navWidth = $derived(navDocked ? 0 : Math.min(320, width - 56));
	const inspectorWidth = $derived(inspector && !inspectorDocked ? Math.min(360, width - 48) : 0);
	const offset = $derived(drag ?? offsetFor(pane, navWidth, inspectorWidth));
	// The open pane slides over the chat instead of sitting beside it.
	const overlaid = $derived(
		(pane === 'navigation' && !navDocked) || (pane === 'inspector' && !inspectorDocked)
	);
	const navigationShown = $derived(pane === 'navigation' || (drag !== null && drag > 0));
	const inspectorShown = $derived(pane === 'inspector' || (drag !== null && drag < 0));
	const footerNav = $derived(nav.filter((item) => item.id !== home && item.id !== 'settings'));
	const badgeTotal = $derived(
		Object.values(badges).reduce<number>(
			(n, value) => n + (typeof value === 'number' ? value : value ? 1 : 0),
			0
		)
	);

	setWorkspace({
		get contentVisible() {
			return !overlaid;
		},
		get docked() {
			return inspectorDocked;
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
			return navDocked && sidebarOpen;
		},
		get docked() {
			return navDocked;
		},
		get channels() {
			return !!navigation;
		}
	});

	/** The Provider's setter; it writes the cookie itself. */
	function setSidebarOpen(value: boolean) {
		const nav = frame?.querySelector('[data-channel-navigation]');
		if (!value && nav?.contains(document.activeElement))
			frame
				?.querySelector<HTMLElement>('[data-slot="sidebar-inset"] [data-sidebar="trigger"]')
				?.focus({ preventScroll: true });
		sidebarOpen = value;
	}
	const sheetOpen = () =>
		!!frame?.querySelector(
			'[data-routed-sheet][data-state="open"],dialog[open],[data-slot="sheet-content"][data-state="open"]'
		);
	// Capture runs before the Provider's own Cmd+B, which below 768 would flip an unused mobile sheet,
	// and at a fractional 767.x width would toggle and persist the desktop sidebar instead.
	function phoneShortcut(e: KeyboardEvent) {
		if (navDocked || e.key !== 'b' || !(e.metaKey || e.ctrlKey)) return;
		e.stopImmediatePropagation();
		e.preventDefault();
		if (e.repeat || !navigation || sheetOpen()) return;
		if (navOpen) closePane();
		else openNavigation();
	}
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
		startedFrom: Pane;
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
	let suppressClick = false;
	function down(e: PointerEvent) {
		suppressClick = false;
		if (
			(!navWidth && !inspectorWidth) ||
			!e.isPrimary ||
			e.button !== 0 ||
			e.pointerType === 'mouse' ||
			(!conversation && pane === 'chat') ||
			(pane !== 'chat' && !overlaid)
		)
			return;
		const target = e.target;
		const paneSurface =
			target instanceof Element &&
			(target.closest('[data-workspace-return]') ||
				(pane === 'navigation' && target.closest('[data-channel-navigation]')) ||
				(pane === 'inspector' && target.closest('[data-workspace-inspector]')));
		if (
			!(target instanceof Element) ||
			target.closest(
				paneSurface
					? 'input,textarea,select,pre,code,[contenteditable],[role="slider"],[role="checkbox"],[data-tab-pager]'
					: excluded
			) ||
			document.getSelection()?.isCollapsed === false
		)
			return;
		if (sheetOpen()) return;
		const rect = root.getBoundingClientRect();
		if (e.clientX - rect.left < motion.edge || rect.right - e.clientX < motion.edge) return;
		for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
			if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX))
				return;
		}
		gesture = {
			id: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			base: offset,
			startedFrom: pane,
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
						inspectorWidth,
						gesture.startedFrom
					)
				: pane;
		suppressClick = gesture.horizontal;
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
		if (e.key !== 'Tab' || !overlaid) return;
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
		addEventListener('keydown', phoneShortcut, { capture: true });
		document.addEventListener('visibilitychange', visibility);
		return () => {
			resize.disconnect();
			removeEventListener('blur', recover);
			removeEventListener('keydown', phoneShortcut, { capture: true });
			document.removeEventListener('visibilitychange', visibility);
		};
	});
	$effect(() => {
		if (navDocked && navOpen) untrack(closePane);
	});
	// Narrowing below a breakpoint turns a docked pane into an overlay over the chat, which goes inert.
	$effect(() => {
		if (!overlaid) return;
		const target = pane;
		void tick().then(() => {
			const active = document.activeElement;
			if (active && active !== document.body && !active.closest('[inert]')) return;
			root
				?.querySelector<HTMLElement>(
					target === 'navigation' ? '[data-channel-navigation]' : '[data-workspace-inspector]'
				)
				?.focus({ preventScroll: true });
		});
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
				} else if (overlaid)
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

{#snippet badge(id: string, size: 'default' | 'sm')}
	{@const value = badges[id]}
	{@const top =
		size === 'sm'
			? 'any-pointer-coarse:peer-data-[size=sm]/menu-button:top-3'
			: 'any-pointer-coarse:peer-data-[size=default]/menu-button:top-3'}
	{#if typeof value === 'number' && value > 0}<Sidebar.MenuBadge
			class={[
				'bg-waiting-soft text-waiting peer-hover/menu-button:text-waiting peer-data-active/menu-button:text-waiting',
				top
			]}>{value}<span class="sr-only"> need you</span></Sidebar.MenuBadge
		>
	{:else if value === true}<Sidebar.MenuBadge class={top}
			><span class="size-2 rounded-full bg-brand"></span><span class="sr-only">Unread</span
			></Sidebar.MenuBadge
		>{/if}
{/snippet}
{#snippet navBody()}
	<Sidebar.Header
		class="h-(--header-height) shrink-0 flex-row items-center border-b border-sidebar-border py-0"
	>
		<Sidebar.Menu class="min-w-0 flex-1">
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg">
					{#snippet child({ props })}
						<a
							{...props}
							href="/settings"
							aria-label="Settings"
							data-sveltekit-replacestate={navOpen ? '' : undefined}
						>
							<span
								class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-accent"
								><img
									src="/brand/mark.png"
									alt=""
									width="32"
									height="20"
									class="h-4 w-6 object-contain"
								/></span
							>
							<span class="grid flex-1 text-start text-sm leading-tight">
								<span class="truncate font-medium">sushii</span>
								<span class="truncate text-xs text-muted-foreground">Settings</span>
							</span>
							<Settings class="ms-auto" />
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
		{#if !navDocked}<Button
				variant="ghost"
				size="icon-sm"
				aria-label="Close channels"
				class="text-muted-foreground"
				onclick={closePane}><X /></Button
			>{/if}
	</Sidebar.Header>
	{#if navigation}{@render navigation()}
	{:else}<Sidebar.Content>
			<Sidebar.Group>
				<Sidebar.Menu>
					{#each nav as item (item.id)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={active === item.id} class="any-pointer-coarse:h-11">
								{#snippet child({ props })}
									<a
										{...props}
										href={item.href}
										aria-current={active === item.id ? 'page' : undefined}
										onclick={(e) => {
											if (item.id === home) onhome?.(e);
											if (!onopenNavigation) standaloneOpen = false;
										}}><item.icon aria-hidden="true" /><span>{item.label}</span></a
									>
								{/snippet}
							</Sidebar.MenuButton>
							{@render badge(item.id, 'default')}
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.Group>
		</Sidebar.Content>{/if}
	{#if navigation}<Sidebar.Footer class="border-t border-sidebar-border">
			<nav aria-label="Workspace">
				<Sidebar.Menu>
					{#each footerNav as item (item.id)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								size="sm"
								isActive={active === item.id}
								class="any-pointer-coarse:h-11 any-pointer-coarse:text-sm"
							>
								{#snippet child({ props })}
									<a
										{...props}
										href={item.href}
										data-sveltekit-replacestate={navOpen ? '' : undefined}
										aria-current={active === item.id ? 'page' : undefined}
										><item.icon aria-hidden="true" /><span>{item.label}</span></a
									>
								{/snippet}
							</Sidebar.MenuButton>
							{@render badge(item.id, 'sm')}
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</nav>
		</Sidebar.Footer>{/if}
{/snippet}

<BitsConfig defaultPortalTo={`#${sheets}`}>
	<Sidebar.Provider
		bind:ref={frame}
		bind:open={() => sidebarOpen, setSidebarOpen}
		role="group"
		aria-label="Channel workspace"
		data-shell
		data-workspace-pane={pane}
		class="isolate h-[calc(100%-var(--kb))] min-h-0 overflow-hidden bg-background text-foreground"
	>
		{#if navDocked}
			<Sidebar.Root
				data-channel-navigation
				role="navigation"
				aria-label="Channel navigation"
				aria-hidden={!sidebarOpen || undefined}
				class="pt-(--safe-top) pb-(--safe-bottom)"
			>
				<div class="flex min-h-0 flex-1 flex-col" inert={!sidebarOpen || overlaid}>
					{@render navBody()}
				</div>
				<!-- The header's trigger is the accessible toggle; the rail is a pointer shortcut. -->
				<Sidebar.Rail aria-hidden="true" class="any-pointer-coarse:hidden" />
			</Sidebar.Root>
		{/if}
		<!-- Sidebar.Inset's classes on a div: each screen renders the page's own <main> -->
		<div
			data-slot="sidebar-inset"
			class="@container relative flex w-full min-w-0 flex-1 flex-col bg-background"
		>
			<div
				bind:this={root}
				role="presentation"
				class="workspace relative min-h-0 flex-1 overflow-hidden"
				class:dragging={drag !== null}
				style:--nav-width={`${navWidth}px`}
				style:--inspector-width={`${inspectorWidth}px`}
				style:--chat-offset={`${offset}px`}
				onclickcapture={(e) => {
					if (!suppressClick || e.detail === 0) return;
					suppressClick = false;
					e.preventDefault();
					e.stopPropagation();
				}}
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={recover}
				onlostpointercapture={(e) => {
					if (e.target === root && gesture && !root.hasPointerCapture(e.pointerId)) recover();
				}}
			>
				{#if !navDocked}
					<div
						data-channel-navigation
						role="dialog"
						aria-label="Menu"
						aria-modal={navOpen ? true : undefined}
						tabindex="-1"
						class="navigation"
						class:exposed={navigationShown}
						inert={pane !== 'navigation'}
						aria-hidden={pane !== 'navigation'}
						onclick={navigationClick}
					>
						<Sidebar.Root collapsible="none" class="min-h-0 w-full flex-1">
							{@render navBody()}
						</Sidebar.Root>
					</div>
				{/if}
				{#if inspector && !inspectorDocked}<aside
						data-workspace-inspector
						aria-label="Conversation tasks"
						tabindex="-1"
						class="inspector"
						class:exposed={inspectorShown}
						inert={pane !== 'inspector'}
						aria-hidden={pane !== 'inspector'}
					>
						<Sidebar.Root collapsible="none" class="min-h-0 w-full flex-1">
							{@render inspector.content()}
						</Sidebar.Root>
					</aside>{/if}
				<div class="chat-surface" data-chat-surface>
					<div
						class="chat-content flex h-full min-h-0 min-w-0 flex-col"
						inert={overlaid}
						aria-hidden={overlaid ? true : undefined}
					>
						{@render children()}
					</div>
					{#if overlaid}<button
							data-workspace-return
							class="return-to-chat"
							class:inspector-return={pane === 'inspector'}
							aria-label="Return to conversation"
							onclick={closePane}><ArrowLeft class="size-5" /></button
						>{/if}
				</div>
			</div>
		</div>
		{#if inspector && inspectorDocked}
			<!-- 20rem rather than the stock 16rem: the panel hosts an agent transcript and its composer.
			     Closed, it collapses in place so its content stays mounted. -->
			<Sidebar.Root
				collapsible="none"
				class={inspector.open
					? 'h-full border-s pt-(--safe-top)'
					: 'invisible h-full w-0 overflow-hidden'}
				style="--sidebar-width: 20rem"
			>
				<aside
					data-workspace-inspector
					aria-label="Conversation tasks"
					tabindex="-1"
					inert={!inspector.open}
					aria-hidden={!inspector.open ? true : undefined}
					class="flex min-h-0 flex-1 flex-col outline-none"
				>
					{@render inspector.content()}
				</aside>
			</Sidebar.Root>
		{/if}
		<div id={sheets}></div>
	</Sidebar.Provider>
</BitsConfig>

<style>
	.workspace {
		isolation: isolate;
		touch-action: pan-y pinch-zoom;
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
	.navigation,
	.navigation :global([data-sidebar='content']),
	.inspector :global(.overflow-y-auto) {
		touch-action: pan-y pinch-zoom;
	}
	@media (prefers-reduced-motion: reduce) {
		.chat-surface {
			transition: none;
		}
	}
</style>
