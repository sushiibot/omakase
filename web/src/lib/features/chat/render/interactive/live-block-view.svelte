<script lang="ts">
	import type { LiveBlock } from '../../../../core/realtime/events';
	import type { RichData } from '../rich/blocks';
	import type { LiveBinding, LiveBlockAccess } from '../rich/live';
	import Checklist from './checklist.svelte';
	import Recipe from './recipe.svelte';
	import Timer from './timer.svelte';

	// A stored checklist, recipe or timer on its own, outside the reply it came from (the saved
	// item page). It is the same component as in chat, bound to the stored block by id, so changes
	// sync with every device and the agent.
	let { block, live }: { block: LiveBlock; live: LiveBlockAccess } = $props();
	const bound = $derived<LiveBinding>({ block, apply: (ops) => live.apply(block.id, ops) });
</script>

{#if block.type === 'checklist'}<Checklist
		data={block.data as RichData<'checklist'>}
		live={bound}
	/>
{:else if block.type === 'recipe'}<Recipe data={block.data as RichData<'recipe'>} live={bound} />
{:else if block.type === 'timer'}<Timer
		label={(block.data as RichData<'timer'>).label}
		seconds={(block.data as RichData<'timer'>).duration}
		storeKey={`live:${block.id}`}
		live={bound}
	/>
{/if}
