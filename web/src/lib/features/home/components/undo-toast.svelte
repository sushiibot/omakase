<script lang="ts">
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { Button } from '$lib/ui/button';

	let { label, onundo }: { label: string; onundo?: () => void } = $props();
</script>

<span class="line-clamp-1 min-w-0 flex-1">Done: {label}</span>
<Button
	variant="link"
	size="sm"
	onclick={() => onundo?.()}
	class="-me-2 font-semibold text-background"
>
	<Undo2 aria-hidden="true" />Undo
</Button>
