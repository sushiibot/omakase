<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		children,
		measure = 'management',
		embedded = false,
		class: className
	}: {
		children: Snippet;
		/** Management lists align with the header; reading content stays comfortably bounded. */
		measure?: 'management' | 'reading' | 'wide';
		/** The containing screen already owns width and gutters. */
		embedded?: boolean;
		class?: string;
	} = $props();
</script>

<div
	data-slot="screen-content"
	class={cn(
		'flex min-w-0 flex-col gap-6 antialiased',
		!embedded && 'w-full px-4 py-5 @3xl:px-5 @3xl:py-6',
		!embedded &&
			{
				management: 'max-w-4xl',
				reading: 'mx-auto max-w-2xl',
				wide: 'mx-auto max-w-3xl'
			}[measure],
		className
	)}
>
	{@render children()}
</div>
