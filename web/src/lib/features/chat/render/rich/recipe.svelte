<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import Users from '@lucide/svelte/icons/users';
	import type { RichData } from './blocks';
	import Frame from './frame.svelte';

	// A recipe: ingredients beside numbered steps on wide screens, stacked on phones.
	let { data }: { data: RichData<'recipe'> } = $props();
	const times = $derived(
		data.time
			? (['prep', 'cook', 'total'] as const).flatMap((k) =>
					data.time?.[k] ? [`${k[0].toUpperCase()}${k.slice(1)} ${data.time[k]}`] : []
				)
			: []
	);
</script>

<Frame note={data.notes}>
	<div class="flex flex-col gap-1">
		<span class="text-base font-semibold">{data.title}</span>
		{#if data.serves || times.length}
			<span class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
				{#if data.serves}<span class="flex items-center gap-1"
						><Users class="size-3.5" aria-hidden="true" />Serves {data.serves}</span
					>{/if}
				{#if times.length}<span class="flex items-center gap-1"
						><Clock class="size-3.5" aria-hidden="true" />{times.join(' · ')}</span
					>{/if}
			</span>
		{/if}
	</div>
	<div class="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
		<section class="flex flex-col gap-2" aria-label="Ingredients">
			<span class="text-xs font-medium text-muted-foreground">Ingredients</span>
			<ul class="flex flex-col divide-y">
				{#each data.ingredients as ing, i (i)}
					<li class="flex gap-2 py-1.5">
						{#if ing.qty !== undefined || ing.unit}<span class="shrink-0 font-medium tabular-nums"
								>{[ing.qty, ing.unit].filter((x) => x !== undefined).join(' ')}</span
							>{/if}
						<span
							>{ing.item}{#if ing.note}<span class="text-muted-foreground">, {ing.note}</span
								>{/if}</span
						>
					</li>
				{/each}
			</ul>
		</section>
		<section class="flex flex-col gap-2" aria-label="Steps">
			<span class="text-xs font-medium text-muted-foreground">Steps</span>
			<ol class="flex flex-col gap-3">
				{#each data.steps as step, i (i)}
					<li class="flex gap-3">
						<span
							class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums"
							aria-hidden="true">{i + 1}</span
						>
						<span class="pt-0.5">{step}</span>
					</li>
				{/each}
			</ol>
		</section>
	</div>
</Frame>
