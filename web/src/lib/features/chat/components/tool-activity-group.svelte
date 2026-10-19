<script lang="ts">
	import { untrack } from 'svelte';
	import * as Trace from '$lib/ui/trace';
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

<Trace.Collapsible bind:open data-tool-activity class="text-ui">
	<Trace.CollapsibleTrigger aria-label={label} class="max-w-full">
		<Trace.Line status={running ? 'running' : undefined}>
			{#each categories.slice(0, 2) as category (category.key)}
				<Trace.Icon><ToolIcon kind={category.kind} /></Trace.Icon>
			{/each}
			<Trace.Title>{categories.map((c) => `${c.label} × ${c.count}`).join(', ')}</Trace.Title>
			{#if running}<Trace.Description class="text-meta text-running">Running</Trace.Description
				>{/if}
		</Trace.Line>
	</Trace.CollapsibleTrigger>
	<Trace.CollapsibleContent hiddenUntilFound>
		<Trace.Root role="list">
			{#each steps as step, index (`${index}:${step.id}`)}<div role="listitem">
					<ToolRow
						{step}
						focused={openStep === step.id}
						bind:open={
							() => expandedSteps[index] ?? openStep === step.id,
							(value) => (expandedSteps[index] = value)
						}
					/>
				</div>{/each}
		</Trace.Root>
	</Trace.CollapsibleContent>
</Trace.Collapsible>
