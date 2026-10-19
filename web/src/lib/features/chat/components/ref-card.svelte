<script lang="ts">
	// The scheduled-job message an owner message answers. Agent-written: plain text only.
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import X from '@lucide/svelte/icons/x';
	import type { MessageRef } from '$lib/core/realtime/events';
	import { Button } from '$lib/ui/button';
	import { ago } from '$lib/ui/format/time';
	import { cn } from '$lib/utils';
	import { parseMarkdown } from '../render/markdown';
	import { plainText } from '../render/plain-text';

	let {
		ref,
		onremove,
		class: className
	}: { ref: MessageRef; onremove?: () => void; class?: string } = $props();

	const excerpt = $derived(plainText(parseMarkdown(ref.excerpt)));
</script>

<section
	aria-label="Replying to {ref.job}{ref.item ? `: ${ref.item.title}` : ''}"
	data-message-ref={ref.id}
	class={cn(
		'flex w-full min-w-0 flex-col gap-1 rounded-xl border bg-muted/30 px-3 py-2.5 text-start text-sm [overflow-wrap:anywhere]',
		className
	)}
>
	<div class="flex min-w-0 items-center gap-2">
		<p class="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
			<CalendarClock class="size-3.5 shrink-0" aria-hidden="true" />
			<span class="truncate">From {ref.job} · {ago(ref.at, Date.now())}</span>
		</p>
		{#if onremove}
			<Button
				variant="ghost"
				size="icon-xs"
				class="-me-1"
				aria-label="Remove the reference"
				title="Remove the reference"
				onclick={onremove}><X /></Button
			>
		{/if}
	</div>
	{#if ref.item}<p class="font-medium">{ref.item.title}</p>{/if}
	{#if excerpt}<p class="line-clamp-3 whitespace-pre-line text-muted-foreground">{excerpt}</p>{/if}
	{#if ref.runId}
		<a
			href="/runs/{ref.runId}"
			class="inline-flex items-center gap-1 self-start text-xs font-medium text-brand hover:underline"
			>View run<ArrowUpRight class="size-3.5" aria-hidden="true" /></a
		>
	{/if}
</section>
