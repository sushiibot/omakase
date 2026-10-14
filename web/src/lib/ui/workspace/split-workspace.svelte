<!-- app: chat beside a docked or sheet inspector (ux-guidelines.md#breakpoints) -->
<script lang="ts">
	import { tick } from 'svelte';
	import type { Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { INSPECTOR_BREAKPOINT } from '$lib/ui/breakpoints';
	let {
		open,
		onopen,
		onclose,
		panel,
		children
	}: { open: boolean; onopen: () => void; onclose: () => void; panel: Snippet; children: Snippet } =
		$props();
	let root: HTMLDivElement;
	const docked = new MediaQuery(`min-width: ${INSPECTOR_BREAKPOINT}px`);
	const mobile = $derived(!docked.current);
	let drag = $state<number | null>(null);
	let gesture: { x: number; y: number; horizontal: boolean } | null = null;
	let wasOpen = false;
	$effect(() => {
		const revealed = open;
		const moved = revealed !== wasOpen;
		wasOpen = revealed;
		if (!root || !mobile || !moved) return;
		void tick().then(() => {
			const target = revealed
				? root.querySelector<HTMLElement>('aside')
				: root.querySelector<HTMLElement>('[aria-label^="Tasks,"]');
			target?.focus({ preventScroll: true });
		});
	});
	function down(e: TouchEvent) {
		if (
			!mobile ||
			e.touches.length !== 1 ||
			(e.target as HTMLElement).closest('input,textarea,button,a,pre,code,[role=tab],select')
		)
			return;
		const t = e.touches[0];
		const rect = root.getBoundingClientRect();
		if (t.clientX < rect.left + 24 || t.clientX > rect.right - 24) return;
		gesture = { x: t.clientX, y: t.clientY, horizontal: false };
	}
	function move(e: TouchEvent) {
		if (!gesture || e.touches.length !== 1) return;
		const t = e.touches[0],
			dx = t.clientX - gesture.x,
			dy = t.clientY - gesture.y;
		if (!gesture.horizontal) {
			if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
				gesture = null;
				return;
			}
			if (Math.abs(dx) < 16 || Math.abs(dx) < Math.abs(dy) * 2) return;
			gesture.horizontal = true;
		}
		if (e.cancelable) e.preventDefault();
		drag = Math.max(0, Math.min(root.clientWidth, (open ? root.clientWidth : 0) - dx));
	}
	function end() {
		if (drag !== null) {
			if (drag > root.clientWidth / 2) {
				if (!open) onopen();
			} else if (open) onclose();
		}
		gesture = null;
		drag = null;
	}
	function cancel() {
		gesture = null;
		drag = null;
	}
	$effect(() => {
		if (!root) return;
		root.addEventListener('touchstart', down, { passive: true });
		root.addEventListener('touchmove', move, { passive: false });
		root.addEventListener('touchend', end);
		root.addEventListener('touchcancel', cancel);
		return () => {
			root.removeEventListener('touchstart', down);
			root.removeEventListener('touchmove', move);
			root.removeEventListener('touchend', end);
			root.removeEventListener('touchcancel', cancel);
		};
	});
</script>

<div
	bind:this={root}
	class="task-workspace min-h-0 min-w-0 flex-1 overflow-hidden"
	class:open
	class:dragging={drag !== null}
	style:--task-offset={drag === null ? (open ? '100%' : '0%') : `${drag}px`}
	data-task-workspace
>
	<div class="workspace-track h-full lg:transform-none!" data-task-track>
		<div
			class="workspace-chat flex min-h-0 w-full min-w-0 flex-none basis-full flex-col lg:w-auto lg:flex-1"
			inert={mobile && open}
			aria-hidden={mobile && open ? true : undefined}
		>
			{@render children()}
		</div>
		<aside
			aria-label="Conversation tasks"
			tabindex="-1"
			class={[
				'workspace-panel flex min-h-0 w-full flex-none basis-full flex-col bg-sidebar text-sidebar-foreground lg:border-s',
				open
					? 'lg:w-(--sidebar-width) lg:basis-(--sidebar-width)'
					: 'lg:invisible lg:w-0 lg:basis-0 lg:overflow-hidden'
			]}
			style="--sidebar-width: 20rem"
			inert={!open}
			aria-hidden={!open ? true : undefined}
			onkeydown={(e) => {
				if (e.key === 'Escape') onclose();
			}}
		>
			{@render panel()}
		</aside>
	</div>
</div>

<style>
	.workspace-track {
		position: relative;
		display: flex;
		transform: translateX(calc(-1 * var(--task-offset)));
		transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.dragging .workspace-track {
		transition: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.workspace-track {
			transition: none;
		}
	}
</style>
