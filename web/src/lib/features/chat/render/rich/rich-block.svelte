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
	import Checklist from '../interactive/checklist.svelte';
	import { hashText } from '../markdown';
	import { fingerprint, type LiveBinding, type LiveBlockAccess } from './live';
	import Stats from './stats.svelte';
	import Timeline from './timeline.svelte';
	import Tree from './tree.svelte';

	// A validated rich block. Display blocks lay out data only: no controls, no markup from the
	// model, links only from fields that passed the markdown link rule or that the component builds.
	// Interactive blocks (../interactive) add device-local controls, and reply blocks send their
	// visible text as the owner's message through `reply`.
	let {
		block,
		reply,
		partial = false,
		live,
		liveKey,
		liveIndex
	}: {
		block: RichBlock;
		/** Sends text as the owner's message; only the latest reply in chat passes it. */
		reply?: (text: string) => void;
		/** The fence is still streaming and `block` is what it holds so far: lists grow, controls are
		 *  off, and a caret shows it is still being written. */
		partial?: boolean;
		/** The live-block store, the reply's key, and this block's place among its live blocks. */
		live?: LiveBlockAccess;
		liveKey?: string;
		liveIndex?: number;
	} = $props();

	const canBind = $derived(!partial && !!live && !!liveKey && liveIndex !== undefined);
	$effect(() => {
		if (canBind) live!.watch([liveKey!]);
	});
	const print = $derived(canBind ? fingerprint(block.data) : '');
	// Bound only to the stored block drawn from this exact data, so a renumbering can't cross wires.
	const bound = $derived.by((): LiveBinding | undefined => {
		if (!canBind) return undefined;
		const stored = live!.get(liveKey!, liveIndex!);
		if (!stored || stored.type !== block.type || stored.fingerprint !== print) return undefined;
		return { block: stored, apply: (ops) => live!.apply(stored.id, ops) };
	});
</script>

<!-- A partial block sits in its own wrapper, so the closed fence mounts the block afresh: recipe and
     timer read their device-local state once, keyed by the block's text, and must do it from the
     finished data. Finished blocks keep their plain markup. -->
{#if partial}
	<div class="relative min-w-0" aria-busy="true">
		{@render body()}
		<!-- Out of the flow, inside the block's bottom padding, so it never moves the layout. -->
		<span
			data-caret
			aria-hidden="true"
			class="absolute right-2.5 bottom-2 h-3 w-0.5 animate-pulse bg-foreground motion-reduce:animate-none"
		></span>
	</div>
{:else}
	{@render body()}
{/if}

{#snippet body()}
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
	{:else if block.type === 'recipe'}<Recipe data={block.data} {partial} live={bound} />
	{:else if block.type === 'checklist'}<Checklist data={block.data} {partial} live={bound} />
	{:else if block.type === 'event'}<Event data={block.data} />
	{:else if block.type === 'place'}<Place data={block.data} />
	{:else if block.type === 'timer'}<Timer
			label={block.data.label}
			seconds={block.data.duration}
			storeKey={hashText(JSON.stringify(block.data))}
			disabled={partial}
			live={bound}
		/>
	{:else if block.type === 'actions'}<Actions
			data={block.data}
			reply={partial ? undefined : reply}
			{partial}
			live={bound}
		/>
	{:else if block.type === 'choice'}<Choice
			data={block.data}
			reply={partial ? undefined : reply}
			{partial}
			live={bound}
		/>
	{:else if block.type === 'form'}<Form
			data={block.data}
			reply={partial ? undefined : reply}
			{partial}
			live={bound}
		/>
	{/if}
{/snippet}
