<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let { children, class: className }: { children: Snippet; class?: string } = $props();
</script>

<div
	class={cn(
		'flex w-full max-w-4xl flex-col gap-6 px-4 py-5 antialiased @3xl:px-5 @3xl:py-6',
		className
	)}
>
	{@render children()}
</div>
