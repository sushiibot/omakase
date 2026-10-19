<script lang="ts">
	import CircleStop from '@lucide/svelte/icons/circle-stop';
	import * as Trace from '$lib/ui/trace';
	import ToolRow from './tool-row.svelte';
	import ToolActivityGroup from './tool-activity-group.svelte';
	import { groupToolActivity } from '../tool-activity';
	import type { Turn } from '../types';
	let { turn, openStep }: { turn: Turn; open?: boolean; openStep?: string } = $props();
</script>

{#each groupToolActivity(turn.steps.map( (step) => ({ type: 'data-tool' as const, data: step }) )) as { part, index } (index)}
	{#if part.type === 'data-tool-group'}<ToolActivityGroup steps={part.data} {openStep} />
	{:else if part.type === 'data-tool'}<ToolRow
			step={part.data}
			open={openStep === part.data.id}
		/>{/if}
{/each}
{#if turn.state === 'stopped'}
	<p class="py-1">
		<Trace.Line class="text-meta">
			<Trace.Icon><CircleStop /></Trace.Icon>
			<Trace.Title>{turn.label ?? 'Stopped by you'}</Trace.Title>
		</Trace.Line>
	</p>
{/if}
