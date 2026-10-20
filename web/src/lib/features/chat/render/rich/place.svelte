<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Star from '@lucide/svelte/icons/star';
	import type { RichData } from './blocks';
	import Frame from './frame.svelte';
	import { mapsUrl } from './links';

	// One place with a maps link built from its name and address.
	let { data }: { data: RichData<'place'> } = $props();
</script>

<Frame>
	<div class="flex gap-3">
		<div
			class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"
			aria-hidden="true"
		>
			<MapPin class="size-5 text-muted-foreground" />
		</div>
		<div class="flex min-w-0 flex-col gap-0.5">
			{#if data.href}<a
					href={data.href}
					target="_blank"
					rel="noopener noreferrer"
					class="font-medium text-brand underline">{data.name}</a
				>{:else}<span class="font-medium">{data.name}</span>{/if}
			{#if data.address}<span class="text-muted-foreground">{data.address}</span>{/if}
			{#if data.rating !== undefined}<span
					class="flex items-center gap-1 text-xs text-muted-foreground"
					><Star class="size-3.5 fill-current text-waiting" aria-hidden="true" />{data.rating}<span
						class="sr-only"
					>
						out of 5</span
					></span
				>{/if}
			{#if data.detail}<span>{data.detail}</span>{/if}
		</div>
	</div>
	<a
		href={mapsUrl(data)}
		target="_blank"
		rel="noopener noreferrer"
		class="self-start text-brand underline">Open in Maps</a
	>
</Frame>
