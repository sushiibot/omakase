<script lang="ts">
	import type { RichBlock } from './blocks';
	import Bars from './bars.svelte';
	import Breakdown from './breakdown.svelte';
	import Cards from './cards.svelte';
	import Compare from './compare.svelte';
	import Event from './event.svelte';
	import Flow from './flow.svelte';
	import Line from './line.svelte';
	import Matrix from './matrix.svelte';
	import Place from './place.svelte';
	import Progress from './progress.svelte';
	import Recipe from './recipe.svelte';
	import Stats from './stats.svelte';
	import Timeline from './timeline.svelte';
	import Tree from './tree.svelte';

	// A validated rich block. Each component lays out data only: no controls, no markup from the
	// model, links only from fields that passed the markdown link rule or that the component builds.
	let { block }: { block: RichBlock } = $props();
</script>

{#if block.type === 'breakdown'}<Breakdown data={block.data} />
{:else if block.type === 'flow'}<Flow data={block.data} />
{:else if block.type === 'stats'}<Stats data={block.data} />
{:else if block.type === 'bars'}<Bars data={block.data} />
{:else if block.type === 'line'}<Line data={block.data} />
{:else if block.type === 'progress'}<Progress data={block.data} />
{:else if block.type === 'compare'}<Compare data={block.data} />
{:else if block.type === 'timeline'}<Timeline data={block.data} />
{:else if block.type === 'matrix'}<Matrix data={block.data} />
{:else if block.type === 'tree'}<Tree data={block.data} />
{:else if block.type === 'cards'}<Cards data={block.data} />
{:else if block.type === 'recipe'}<Recipe data={block.data} />
{:else if block.type === 'event'}<Event data={block.data} />
{:else if block.type === 'place'}<Place data={block.data} />
{/if}
