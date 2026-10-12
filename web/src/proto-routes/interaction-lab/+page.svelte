<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Hash from '@lucide/svelte/icons/hash';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { Button } from '$lib/ui/button';
	import {
		clampOffset,
		horizontalIntent,
		motion,
		offsetFor,
		releasePane,
		type Pane
	} from './pane-motion';

	let workspace: HTMLElement;
	let width = $state(412);
	let ready = $state(false);
	let returnFocus: HTMLElement | null = null;
	let drag = $state<number | null>(null);
	let selected = $state('Deployment');
	let draft = $state('');
	let theme = $state(false);
	let compactPreview = $state(false);
	let groupCollapsed = $state(false);
	let viewportHeight = $state('100dvh');
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
	let closing = false;
	let previousPane: Pane = 'chat';
	const channels = ['General', 'UI redesign', 'Deployment', 'Release checklist'];
	const pane = $derived((page.state as App.PageState & { labPane?: Pane }).labPane ?? 'chat');
	const wide = $derived(width >= 1100);
	const navigationWidth = $derived(Math.min(320, width - 56));
	const inspectorWidth = $derived(Math.min(360, width - 48));
	const offset = $derived(wide ? 0 : (drag ?? offsetFor(pane, navigationWidth, inspectorWidth)));
	const activeNavigation = $derived(wide || pane === 'navigation');
	const activeInspector = $derived(pane === 'inspector');
	const showNavigation = $derived(activeNavigation || (drag !== null && drag > 0));
	const showInspector = $derived(activeInspector || (drag !== null && drag < 0));
	const excluded =
		'a,button,input,textarea,select,summary,pre,code,[contenteditable],[role="slider"],[role="tab"]';

	function recover() {
		gesture = null;
		drag = null;
	}
	onMount(() => {
		const viewport = window.visualViewport;
		const measureViewport = () => {
			// Keyboard overlays change the visual viewport. Pinch zoom keeps the layout stable.
			viewportHeight = viewport?.scale === 1 ? `${viewport.height}px` : '100dvh';
		};
		measureViewport();
		viewport?.addEventListener('resize', measureViewport);
		width = workspace.clientWidth;
		ready = true;
		let measuredWidth = workspace.clientWidth,
			measuredHeight = workspace.clientHeight;
		const resize = new ResizeObserver(() => {
			const nextWidth = workspace.clientWidth,
				nextHeight = workspace.clientHeight;
			if (nextWidth !== measuredWidth || nextHeight !== measuredHeight) recover();
			measuredWidth = nextWidth;
			measuredHeight = nextHeight;
			width = nextWidth;
		});
		resize.observe(workspace);
		const visibility = () => {
			if (document.hidden) recover();
		};
		const back = () => {
			closing = false;
			recover();
		};
		addEventListener('blur', recover);
		addEventListener('popstate', back);
		document.addEventListener('visibilitychange', visibility);
		return () => {
			viewport?.removeEventListener('resize', measureViewport);
			resize.disconnect();
			removeEventListener('blur', recover);
			removeEventListener('popstate', back);
			document.removeEventListener('visibilitychange', visibility);
		};
	});

	async function selectPane(next: Pane, trigger?: HTMLElement) {
		recover();
		if (next === pane) return;
		if (next === 'chat') {
			if (closing) return;
			closing = true;
			history.back();
		} else {
			if (pane === 'chat')
				returnFocus =
					trigger ??
					(document.activeElement instanceof HTMLElement ? document.activeElement : null);
			const state = { ...page.state, labPane: next };
			if (pane !== 'chat') replaceState('', state);
			else pushState('', state);
			await tick();
			workspace.querySelector<HTMLElement>(`[data-pane="${next}"]`)?.focus({ preventScroll: true });
		}
	}

	$effect(() => {
		const current = pane;
		if (current !== previousPane) {
			const prior = previousPane;
			previousPane = current;
			if (current === 'chat' && prior !== 'chat' && workspace) {
				void tick().then(() =>
					requestAnimationFrame(() => {
						(returnFocus?.isConnected
							? returnFocus
							: workspace.querySelector<HTMLElement>('[data-open-navigation]')
						)?.focus({ preventScroll: true });
					})
				);
			}
		}
	});

	function down(e: PointerEvent) {
		if (wide || !e.isPrimary || e.button !== 0 || e.pointerType === 'mouse') return;
		const target = e.target;
		if (
			!(target instanceof HTMLElement) ||
			target.closest(excluded) ||
			document.getSelection()?.isCollapsed === false
		)
			return;
		const rect = workspace.getBoundingClientRect();
		if (e.clientX - rect.left < motion.edge || rect.right - e.clientX < motion.edge) return;
		for (let el: HTMLElement | null = target; el && el !== workspace; el = el.parentElement) {
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
			workspace.setPointerCapture(e.pointerId);
		}
		const now = performance.now(),
			elapsed = now - gesture.at;
		if (elapsed > 0) gesture.velocity = (e.clientX - gesture.lastX) / elapsed;
		gesture.lastX = e.clientX;
		gesture.at = now;
		drag = clampOffset(gesture.base + dx, navigationWidth, inspectorWidth);
	}
	function up(e: PointerEvent) {
		if (gesture?.id !== e.pointerId) return;
		const next =
			drag !== null && gesture.horizontal
				? releasePane(
						drag,
						performance.now() - gesture.at > 80 ? 0 : gesture.velocity,
						navigationWidth,
						inspectorWidth,
						pane
					)
				: pane;
		if (workspace.hasPointerCapture(e.pointerId)) workspace.releasePointerCapture(e.pointerId);
		gesture = null;
		void selectPane(next);
	}
</script>

<svelte:head><title>Channel interaction lab · sushii</title></svelte:head>
<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && pane !== 'chat') {
			e.preventDefault();
			void selectPane('chat');
		}
	}}
/>

<div
	class:dark={theme}
	class="lab bg-background text-foreground"
	style:--lab-height={viewportHeight}
>
	<div class="lab-heading">
		<div>
			<h1>Channel interaction lab</h1>
			<p>Sample content. Drag the chat right for channels or left for details.</p>
		</div>
		<div class="lab-actions">
			<Button
				class="lab-action"
				variant="outline"
				onclick={() => (compactPreview = !compactPreview)}
				>{compactPreview ? 'Use available width' : 'Phone preview'}</Button
			>
			<Button class="lab-action" variant="outline" onclick={() => (theme = !theme)}
				>{theme ? 'Light theme' : 'Dark theme'}</Button
			>
		</div>
	</div>
	<section
		bind:this={workspace}
		aria-label="Channel workspace"
		data-ready={ready}
		class="workspace"
		class:phone={compactPreview}
		class:wide
		class:dragging={drag !== null}
		style:--navigation-width={`${navigationWidth}px`}
		style:--inspector-width={`${inspectorWidth}px`}
		style:--chat-offset={`${offset}px`}
		style:--inspector-column={activeInspector ? '320px' : '0px'}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={recover}
		onlostpointercapture={(e) => {
			if (e.target === workspace && gesture && !workspace.hasPointerCapture(e.pointerId)) recover();
		}}
	>
		<nav
			aria-label="Channels"
			data-pane="navigation"
			tabindex="-1"
			class="navigation"
			class:exposed={showNavigation}
			inert={!activeNavigation}
			aria-hidden={!activeNavigation}
		>
			<header>
				<span class="min-w-0 truncate font-semibold">sushii</span>{#if !wide}<Button
						size="icon"
						class="pane-control"
						variant="ghost"
						aria-label="Close channels"
						onclick={() => selectPane('chat')}><X /></Button
					>{/if}
			</header>
			<div class="channels">
				<button
					class="channel"
					class:selected={selected === 'Main'}
					aria-current={selected === 'Main' ? 'page' : undefined}
					onclick={() => {
						selected = 'Main';
						void selectPane('chat');
					}}><Hash class="size-4" /><span>Main</span></button
				>
				<button
					class="project"
					aria-label="Sushii channels"
					aria-expanded={!groupCollapsed}
					aria-controls="lab-project-channels"
					onclick={() => (groupCollapsed = !groupCollapsed)}
					><ChevronDown class={groupCollapsed ? 'collapsed size-4' : 'size-4'} /><span>Sushii</span
					></button
				>
				<div id="lab-project-channels" class="channel-group" hidden={groupCollapsed}>
					{#each channels as channel}<button
							class="channel"
							class:has-request={channel === 'Deployment'}
							class:selected={selected === channel}
							aria-current={selected === channel ? 'page' : undefined}
							onclick={() => {
								selected = channel;
								void selectPane('chat');
							}}
							><Hash class="size-4" /><span>{channel}</span>{#if channel === 'Deployment'}<span
									class="ping">1<span class="sr-only"> request needs you</span></span
								>{/if}</button
						>{/each}
				</div>
			</div>
			<footer>
				<p>Tasks · Activity · Workspace</p>
			</footer>
		</nav>
		<aside
			aria-label="Channel inspector"
			data-pane="inspector"
			tabindex="-1"
			class="inspector"
			class:exposed={showInspector}
			inert={!activeInspector}
			aria-hidden={!activeInspector}
		>
			<header>
				<span class="min-w-0 truncate font-semibold">{selected} details</span><Button
					size="icon"
					class="pane-control"
					variant="ghost"
					aria-label="Close details"
					onclick={() => selectPane('chat')}><X /></Button
				>
			</header>
			<div class="inspector-content">
				<h2>Release checklist</h2>
				<p class="text-sm text-muted-foreground">Supporting details for this channel.</p>
				<label><input type="checkbox" checked />Run checks</label><label
					><input type="checkbox" checked />Review changes</label
				><label><input type="checkbox" />Choose deployment window</label>
				<h2>Needs your response</h2>
				<p>Choose a deployment window in the channel conversation.</p>
				<Button class="workspace-action" variant="outline" onclick={() => selectPane('chat')}
					>Return to conversation</Button
				>
			</div>
		</aside>
		<div class="chat" data-chat-surface>
			<div
				class="chat-content"
				inert={!wide && pane !== 'chat'}
				aria-hidden={!wide && pane !== 'chat'}
			>
				<header>
					{#if !wide}<Button
							size="icon"
							class="pane-control"
							data-open-navigation
							variant="ghost"
							aria-label="Open channels"
							aria-expanded={pane === 'navigation'}
							onclick={(e) => selectPane('navigation', e.currentTarget)}><Menu /></Button
						>{/if}<span class="min-w-0 flex-1 truncate font-semibold">{selected}</span><Button
						size="icon"
						class="pane-control"
						variant="ghost"
						aria-label="Open details"
						aria-expanded={activeInspector}
						onclick={(e) => selectPane(activeInspector ? 'chat' : 'inspector', e.currentTarget)}
						><ListChecks /></Button
					>
				</header>
				<div class="request">
					<span>1 request needs your response</span><button
						onclick={() =>
							document.getElementById('lab-request')?.scrollIntoView({ block: 'nearest' })}
						>Review</button
					>
				</div>
				<div class="transcript">
					<article>
						<span>You <time>10:42</time></span>
						<p>Check whether the release is ready, and let me know if you need a decision.</p>
					</article>
					<article>
						<span>Sushii <time>10:43</time></span>
						<p>The checks passed. The changes are ready for review.</p>
						<p id="lab-request">Which deployment window works for you?</p>
						<div class="choices">
							<Button
								class="workspace-action"
								variant="outline"
								onclick={() => (draft = 'Deploy this afternoon')}>This afternoon</Button
							><Button
								class="workspace-action"
								variant="outline"
								onclick={() => (draft = 'Deploy tomorrow morning')}>Tomorrow morning</Button
							>
						</div>
					</article>
					<article>
						<span>You <time>10:44</time></span>
						<p>Show me the task details first.</p>
					</article>
					<article>
						<span>Sushii <time>10:44</time></span>
						<p>
							The checklist is in the details panel. Your answer stays attached to this channel.
						</p>
						<pre><code>{'release/status: checks passed\nowner/decision: deployment window'}</code
							></pre>
					</article>
				</div>
				<div class="composer">
					<p class="activity">Sample: Sushii is checking deployment…</p>
					<textarea
						aria-label="Message draft"
						bind:value={draft}
						placeholder="Message this channel…"
						rows="2"></textarea>
				</div>
			</div>
			{#if !wide && pane !== 'chat'}<button
					class="return-to-chat"
					aria-label="Return to chat"
					onclick={() => selectPane('chat')}><ArrowLeft class="size-5" /></button
				>{/if}
		</div>
	</section>
</div>

<style>
	.lab {
		--content-gutter: 16px;
		--control-size: 48px;
		--channel-height: 48px;
		--channel-gap: 0px;
		--channel-icon: 20px;
		--channel-text: 1rem;
		--channel-inset: 4px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		height: var(--lab-height, 100dvh);
		padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
			max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
	}
	.lab-heading {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		max-width: 1440px;
		width: 100%;
		margin-inline: auto;
	}
	h1 {
		font-size: 1.25rem;
		font-weight: 600;
	}
	.lab-heading p {
		font-size: var(--text-ui);
		color: var(--muted-foreground);
		margin-top: 4px;
	}
	.lab-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.workspace {
		position: relative;
		isolation: isolate;
		flex: 1;
		min-height: 0;
		max-height: 780px;
		width: 100%;
		max-width: 1440px;
		margin-inline: auto;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--sidebar);
		touch-action: pan-y pinch-zoom;
	}
	.workspace.phone {
		max-width: 412px;
	}
	header {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 56px;
		padding: 4px 8px;
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
	.navigation:not(.exposed),
	.inspector:not(.exposed) {
		visibility: hidden;
	}
	.navigation {
		left: 0;
		width: var(--navigation-width);
	}
	.inspector {
		right: 0;
		width: var(--inspector-width);
	}
	.navigation header,
	.inspector header {
		justify-content: space-between;
		padding-left: var(--content-gutter);
	}
	:global(.pane-control) {
		width: var(--control-size);
		height: var(--control-size);
		padding: 0;
	}
	:global(.lab-action),
	:global(.workspace-action) {
		height: auto;
		min-height: var(--control-size);
		padding: 8px 16px;
		white-space: normal;
		line-height: 1.5;
	}
	.channels {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--channel-gap);
		padding: 8px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.project {
		display: grid;
		grid-template-columns: var(--channel-icon) minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
		min-height: var(--channel-height);
		margin-top: 16px;
		padding: 8px;
		text-align: left;
		font-size: var(--text-ui);
		font-weight: 600;
		color: var(--muted-foreground);
	}
	.project :global(svg) {
		justify-self: center;
	}
	.project :global(svg.collapsed) {
		transform: rotate(-90deg);
	}
	.channel-group {
		display: flex;
		flex-direction: column;
		gap: var(--channel-gap);
	}
	.channel-group[hidden] {
		display: none;
	}
	.channel {
		position: relative;
		isolation: isolate;
		width: 100%;
		flex-shrink: 0;
		display: grid;
		grid-template-columns: var(--channel-icon) minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		padding: 8px;
		min-height: var(--channel-height);
		font-size: var(--channel-text);
		line-height: 1.5;
		font-weight: 500;
		color: var(--muted-foreground);
		text-align: left;
		border-radius: 6px;
	}
	.channel::before {
		content: '';
		position: absolute;
		inset: var(--channel-inset) 0;
		z-index: -1;
		border-radius: 6px;
		background: var(--channel-background, transparent);
	}
	.channel :global(svg) {
		width: var(--channel-icon);
		height: var(--channel-icon);
	}
	.channel > span:not(.ping) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (hover: hover) {
		.channel:not(.selected):hover {
			--channel-background: color-mix(in oklch, var(--sidebar-foreground) 6%, var(--sidebar));
			color: var(--sidebar-foreground);
		}
	}
	.channel.selected {
		--channel-background: color-mix(in oklch, var(--sidebar-foreground) 12%, var(--sidebar));
		color: var(--sidebar-foreground);
	}
	.channel.has-request {
		font-weight: 600;
	}
	.channel:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
	.ping {
		display: grid;
		place-items: center;
		min-width: 20px;
		height: 20px;
		padding-inline: 5px;
		border-radius: 12px;
		background: var(--waiting-soft);
		color: var(--waiting);
		font-size: var(--text-meta);
		font-weight: 600;
	}
	footer {
		flex-shrink: 0;
		padding: var(--content-gutter);
		border-top: 1px solid var(--border);
		font-size: var(--text-ui);
	}
	.inspector-content {
		flex: 1;
		min-height: 0;
		padding: var(--content-gutter);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	h2 {
		font-size: var(--text-body);
		font-weight: 600;
		margin-bottom: 8px;
	}
	.inspector-content h2:not(:first-child) {
		margin-top: 24px;
	}
	.inspector-content label {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		font-size: var(--text-ui);
	}
	.inspector-content label + label {
		margin-top: 8px;
	}
	.inspector-content p {
		margin-bottom: 16px;
		font-size: var(--text-ui);
	}
	.chat {
		position: absolute;
		inset: 0;
		z-index: 1;
		background: var(--background);
		transform: translateX(var(--chat-offset));
		transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.chat-content {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.dragging .chat {
		transition: none;
		user-select: none;
	}
	.request {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 48px;
		flex-shrink: 0;
		gap: 8px;
		padding-inline: var(--content-gutter);
		background: var(--waiting-soft);
		color: var(--waiting);
		font-size: var(--text-ui);
	}
	.request > span {
		min-width: 0;
		padding-block: 8px;
	}
	.request button {
		flex-shrink: 0;
		min-height: 48px;
		min-width: 48px;
		font-weight: 600;
	}
	.channels,
	.inspector-content,
	.transcript {
		touch-action: pan-y pinch-zoom;
	}
	.transcript {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--content-gutter);
	}
	article {
		max-width: 70ch;
		margin-bottom: 16px;
		font-size: var(--text-body);
		line-height: var(--text-body--line-height);
	}
	article > span {
		font-weight: 600;
	}
	time {
		margin-left: 8px;
		font-size: var(--text-meta);
		font-weight: 400;
		color: var(--muted-foreground);
	}
	article p {
		margin-top: 8px;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 12px;
	}
	pre {
		font-size: var(--text-code);
		overflow-x: auto;
		padding: 12px;
		margin-top: 12px;
		background: var(--muted);
		border-radius: 6px;
		touch-action: pan-x pan-y;
	}
	.composer {
		flex-shrink: 0;
		padding: 8px var(--content-gutter) var(--content-gutter);
	}
	.activity {
		min-height: 24px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-meta);
		color: var(--muted-foreground);
	}
	textarea {
		display: block;
		width: 100%;
		resize: none;
		padding: 12px;
		border: 1px solid var(--input);
		border-radius: 8px;
		font-size: 1rem;
		background: var(--background);
	}
	.return-to-chat {
		position: absolute;
		inset: 0;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: flex-start;
		padding: 16px;
		background: color-mix(in oklab, var(--foreground) 5%, transparent);
	}
	button:focus-visible,
	textarea:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.wide {
		display: grid;
		grid-template-columns: 256px minmax(0, 1fr) var(--inspector-column);
	}
	.wide .navigation,
	.wide .inspector,
	.wide .chat {
		position: relative;
		inset: auto;
		width: auto;
		transform: none;
	}
	.wide .navigation {
		grid-column: 1;
		grid-row: 1;
		border-right: 1px solid var(--border);
	}
	.wide .chat {
		grid-column: 2;
		grid-row: 1;
	}
	.wide .chat header {
		padding-left: var(--content-gutter);
	}
	.wide .inspector {
		grid-column: 3;
		grid-row: 1;
		min-width: 0;
		overflow: hidden;
		border-left: 1px solid var(--border);
	}
	@media (max-width: 640px) {
		.lab {
			gap: 12px;
			padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right))
				max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
		}
		.lab-heading {
			flex-direction: column;
			align-items: flex-start;
		}
	}
	@media (hover: hover) and (pointer: fine) {
		.wide {
			--channel-height: 36px;
			--channel-icon: 18px;
			--channel-text: var(--text-ui);
			--channel-inset: 2px;
		}
		.wide .channel {
			padding-block: 6px;
		}
	}
	@media (any-pointer: coarse) {
		.wide {
			--channel-height: 48px;
			--channel-icon: 20px;
			--channel-text: 1rem;
			--channel-inset: 4px;
		}
		.wide .channel {
			padding-block: 8px;
		}
	}
	@media (max-height: 650px) {
		.lab-heading {
			gap: 8px;
		}
		.lab-heading h1 {
			/* Demo chrome yields to the conversation at keyboard/landscape heights. */
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
		.lab-heading p {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.chat {
			transition: none;
		}
	}
</style>
