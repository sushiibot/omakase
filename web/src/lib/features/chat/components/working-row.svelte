<script lang="ts">
	import CircleStop from '@lucide/svelte/icons/circle-stop';
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
	<p class="flex items-center gap-2 py-1 text-meta text-muted-foreground">
		<CircleStop class="size-4" aria-hidden="true" />{turn.label ?? 'Stopped by you'}
	</p>
{/if}
