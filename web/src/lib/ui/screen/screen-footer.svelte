<!-- modeled on shadcn-svelte card-footer, spanning the screen with its contents on the body measure -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { measureClass } from '$lib/ui/page';
	import { cn } from '$lib/utils';
	import { getScreenContext } from './context';

	let { class: className, children }: { class?: string; children: Snippet } = $props();

	const screen = getScreenContext();
</script>

<div data-slot="screen-footer" class="border-t">
	<div
		class={cn(
			'flex flex-col gap-2 px-4 py-3 md:px-6',
			measureClass[screen?.measure ?? 'reading'],
			className
		)}
	>
		{@render children()}
	</div>
</div>
