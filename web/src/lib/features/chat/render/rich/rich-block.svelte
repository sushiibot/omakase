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
	import Recipe from '../interactive/recipe.svelte';
	import Timer from '../interactive/timer.svelte';
	import Actions from '../interactive/actions.svelte';
	import Choice from '../interactive/choice.svelte';
	import Form from '../interactive/form.svelte';
	import { hashText } from '../markdown';
	import Stats from './stats.svelte';
	import Timeline from './timeline.svelte';
	import Tree from './tree.svelte';

	// A validated rich block. Display blocks lay out data only: no controls, no markup from the
	// model, links only from fields that passed the markdown link rule or that the component builds.
	// Interactive blocks (../interactive) add device-local controls, and reply blocks send their
	// visible text as the owner's message through `reply`.
	let {
		block,
		reply
	}: {
		block: RichBlock;
		/** Sends text as the owner's message; only the latest reply in chat passes it. */
		reply?: (text: string) => void;
	} = $props();
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
{:else if block.type === 'timer'}<Timer
		label={block.data.label}
		seconds={block.data.duration}
		storeKey={hashText(JSON.stringify(block.data))}
	/>
{:else if block.type === 'actions'}<Actions data={block.data} {reply} />
{:else if block.type === 'choice'}<Choice data={block.data} {reply} />
{:else if block.type === 'form'}<Form data={block.data} {reply} />
{/if}
