<script lang="ts">
	import { Skeleton } from '$lib/ui/skeleton';

	// Holds a rich block's place while its fence streams, so raw YAML never flashes before it renders.
	let { type }: { type: string } = $props();
</script>

<div
	class="my-1 flex flex-col gap-3 rounded-xl border bg-card p-4"
	role="status"
	aria-label="Loading {type}"
>
	<Skeleton class="h-4 w-1/3" />
	<Skeleton class="h-16 w-full" />
</div>
