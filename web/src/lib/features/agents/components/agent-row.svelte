<script lang="ts">
	import { cn } from '$lib/utils';
	import * as Item from '$lib/ui/item';
	import StatusGlyph from './status-glyph.svelte';
	import { agentAge, agentMeta, agentState } from '../model';
	import type { AgentRecord } from '../types';
	let {
		agent,
		now,
		href,
		unread = false,
		card = false,
		onopen
	}: {
		agent: AgentRecord;
		now: number;
		href: string;
		/** A finished result the owner has not opened on this device. */
		unread?: boolean;
		/** The bordered in-chat form of the same row. */
		card?: boolean;
		onopen?: (event: MouseEvent) => void;
	} = $props();
	const status = $derived(agentState(agent));
	const labelTone: Record<string, string> = {
		waiting: 'text-waiting',
		stale: 'text-waiting',
		failed: 'text-failed'
	};
</script>

<Item.Root
	variant={card ? 'outline' : 'default'}
	size="xs"
	class="min-h-12 flex-nowrap items-start desktop-pointer:min-h-0"
>
	{#snippet child({ props })}
		<a {...props} {href} data-agent-row={agent.id} onclick={onopen}>
			<StatusGlyph of={status.of} class="mt-0.5" />
			<span class="flex min-w-0 flex-1 flex-col gap-0.5">
				<span class="flex min-w-0 items-baseline gap-2">
					<span class="min-w-0 truncate text-sm font-medium text-foreground">{agent.title}</span>
					{#if unread}<span
							class="size-2 shrink-0 self-center rounded-full bg-brand"
							aria-hidden="true"
						></span><span class="sr-only">New result</span>{/if}
					<span class="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"
						>{agentAge(agent, now)}</span
					>
				</span>
				<span class="min-w-0 truncate text-xs text-muted-foreground"
					><span class={cn('font-medium', labelTone[status.of])}>{status.label}</span
					>{#if status.detail}{' · '}{status.detail}{/if}</span
				>
				<span class="min-w-0 truncate text-xs text-muted-foreground">{agentMeta(agent)}</span>
			</span>
		</a>
	{/snippet}
</Item.Root>
