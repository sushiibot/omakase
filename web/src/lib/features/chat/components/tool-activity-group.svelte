<script lang="ts">
	import { Spinner } from '$lib/ui/spinner';
	import { untrack } from 'svelte';
	import * as Collapsible from '$lib/ui/collapsible';
	import DisclosureTrigger from '$lib/ui/collapsible/disclosure-trigger.svelte';
	import ToolIcon from './tool-icon.svelte';
	import ToolRow from './tool-row.svelte';
	import { activityCategories } from '../tool-activity';
	import type { TurnStep } from '../types';
	let {
		steps,
		openStep,
		open = $bindable(steps.some((step) => step.id === openStep))
	}: { steps: TurnStep[]; openStep?: string; open?: boolean } = $props();
	// A lone expanded call can become a group when the next call arrives.
	let expandedSteps = $state<Record<number, boolean>>({
		0: untrack(() => open && (!openStep || steps[0]?.id === openStep))
	});
	const focusedStep = $derived(steps.some((step) => step.id === openStep) ? openStep : undefined);
	$effect(() => {
		if (focusedStep) open = true;
	});
	const categories = $derived(activityCategories(steps));
	const running = $derived(steps.some((step) => step.state === 'running'));
	const label = $derived(
		`${steps.length} tool calls: ${categories.map((c) => `${c.label} × ${c.count}`).join(', ')}${running ? ', running' : ''}`
	);
</script>

<Collapsible.Root bind:open data-tool-activity class="min-w-0 text-ui text-muted-foreground">
	<DisclosureTrigger aria-label={label} class="py-1">
		<span class="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
			{#each categories.slice(0, 2) as category (category.key)}
				<span class="flex min-w-0 items-center gap-1.5 whitespace-nowrap"
					><ToolIcon kind={category.kind} /><span class="truncate"
						>{category.label} × {category.count}</span
					></span
				>
			{/each}
			{#if categories.length > 2}<span class="shrink-0 text-meta">+{categories.length - 2}</span
				>{/if}
		</span>
		{#if running}<span class="flex shrink-0 items-center gap-1 text-meta text-running"
				><Spinner decorative class="size-3.5" /><span>Running</span></span
			>{/if}
	</DisclosureTrigger>
	<Collapsible.Content hiddenUntilFound>
		<ul class="min-w-0 border-l pl-3">
			{#each steps as step, index (`${index}:${step.id}`)}<li>
					<ToolRow
						{step}
						focused={openStep === step.id}
						bind:open={
							() => expandedSteps[index] ?? openStep === step.id,
							(value) => (expandedSteps[index] = value)
						}
					/>
				</li>{/each}
		</ul>
	</Collapsible.Content>
</Collapsible.Root>
