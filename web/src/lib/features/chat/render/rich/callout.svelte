<script lang="ts">
	import type { Snippet } from 'svelte';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Info from '@lucide/svelte/icons/info';
	import OctagonAlert from '@lucide/svelte/icons/octagon-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { Tone } from './blocks';
	import { toneLabel, toneSurface, toneText } from './viz';

	// `:::callout` around markdown: a tinted note with an icon. The tone is also announced in words.
	let { tone, title, children }: { tone: Tone; title: string | null; children: Snippet } = $props();
	const Icon = $derived(
		tone === 'success'
			? CircleCheck
			: tone === 'warn'
				? TriangleAlert
				: tone === 'danger'
					? OctagonAlert
					: Info
	);
</script>

<aside class={['my-1 flex gap-2.5 rounded-lg px-3 py-2.5', toneSurface[tone]]}>
	<Icon class={['mt-1 size-4 shrink-0', toneText[tone]]} aria-hidden="true" />
	<div class="flex min-w-0 flex-1 flex-col gap-1">
		<span class="sr-only">{toneLabel[tone]}:</span>
		{#if title}<span class="font-semibold">{title}</span>{/if}
		{@render children()}
	</div>
</aside>
