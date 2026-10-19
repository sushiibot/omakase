<script lang="ts">
	// One thing a scheduled job flagged. Agent-written: markdown and plain text only, never HTML.
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
	import type { HomeMessageItem } from '$lib/core/realtime/events';
	import { Markdown } from '$lib/features/chat';
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';

	let {
		item,
		answer,
		onreply
	}: {
		item: HomeMessageItem;
		/** The owner's reply so far, from this device or the bot. */
		answer?: string;
		/** `index` is set for a tapped choice. */
		onreply?: (text: string, index?: number) => void;
	} = $props();
	const uid = $props.id();
	let text = $state('');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const reply = text.trim();
		if (!reply) return;
		onreply?.(reply);
		text = '';
	}
</script>

<section
	aria-labelledby="{uid}-t"
	data-job-item={item.key}
	class="flex min-w-0 flex-col gap-3 rounded-xl border bg-muted/30 p-3 [overflow-wrap:anywhere]"
>
	<div class="flex min-w-0 flex-col gap-1">
		<h3 id="{uid}-t" class="text-sm font-medium">{item.title}</h3>
		{#if item.body}<div class="text-ui"><Markdown text={item.body} /></div>{/if}
		{#if item.url}
			<a
				href={item.url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center gap-1 self-start text-sm font-medium text-brand hover:underline"
				>Open link<ArrowUpRight class="size-3.5" aria-hidden="true" /></a
			>
		{/if}
	</div>
	{#if answer}
		<p class="text-sm" role="status">
			<span class="text-muted-foreground">You replied:</span>
			{answer}
		</p>
	{/if}
	{#if item.choices.length}
		<div
			role="group"
			aria-label="Replies to {item.title}"
			class="flex min-w-0 flex-wrap gap-2 any-pointer-coarse:gap-4"
		>
			{#each item.choices as choice, index (index)}
				<Button
					variant="outline"
					class="h-auto min-h-8 max-w-full rounded-full px-4 py-2 font-medium whitespace-normal"
					onclick={() => onreply?.(choice, index)}>{choice}</Button
				>
			{/each}
		</div>
	{/if}
	<!-- 24px from the chips on touch: the field has no ::after, so taps near it drift onto a chip. -->
	<form class="flex gap-2 any-pointer-coarse:mt-6 any-pointer-coarse:gap-6" onsubmit={submit}>
		<label for="{uid}-a" class="sr-only">Your own reply to {item.title}</label>
		<Input
			id="{uid}-a"
			bind:value={text}
			placeholder={item.choices.length ? 'Or write a reply' : 'Write a reply'}
			class="min-w-0 flex-1"
		/>
		<Button type="submit" variant="outline" size="icon" disabled={!text.trim()}
			><SendHorizontal /><span class="sr-only">Send reply</span></Button
		>
	</form>
</section>
