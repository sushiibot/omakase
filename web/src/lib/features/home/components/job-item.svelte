<script lang="ts">
	// One thing a scheduled job flagged. Agent-written: markdown and plain text only, never HTML.
	// A row, not a card: title, topic, body, then one line of actions with 👍/👎 at its end. A 👎 acts at
	// once and is undone in place, so the owner never confirms a mute.
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import Reply from '@lucide/svelte/icons/reply';
	import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
	import ThumbsDown from '@lucide/svelte/icons/thumbs-down';
	import ThumbsUp from '@lucide/svelte/icons/thumbs-up';
	import type { HomeItemRating, HomeMessageItem } from '$lib/core/realtime/events';
	import { Markdown } from '$lib/features/chat';
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';

	let {
		item,
		answer,
		rating,
		onreply,
		onrate
	}: {
		item: HomeMessageItem;
		/** The owner's reply so far, from this device or the bot. */
		answer?: string;
		/** The owner's 👍/👎 so far, from this device or the bot. */
		rating?: HomeItemRating | null;
		/** `index` is set for a tapped choice. */
		onreply?: (text: string, index?: number) => void;
		/** null clears the rating, and the mute a 👎 set. */
		onrate?: (rating: HomeItemRating | null) => void;
	} = $props();
	const uid = $props.id();
	let text = $state('');
	let replying = $state(false);
	let field = $state<HTMLInputElement | null>(null);

	const muted = $derived(rating?.value === 'down');
	const topicMuted = $derived(muted && rating?.scope === 'topic' && !!item.topic);

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const reply = text.trim();
		if (!reply) return;
		onreply?.(reply);
		text = '';
		replying = false;
	}

	function openReply() {
		replying = true;
		queueMicrotask(() => field?.focus());
	}

	const toggle = (value: 'up' | 'down') =>
		onrate?.(
			rating?.value === value
				? null
				: { value, ...(value === 'down' ? { scope: item.topic ? 'topic' : 'item' } : {}) }
		);
</script>

<section
	aria-labelledby="{uid}-t"
	data-job-item={item.key}
	data-rating={rating?.value}
	class="flex min-w-0 flex-col gap-2 py-3 [overflow-wrap:anywhere] first:pt-0 last:pb-0"
>
	<div class="flex min-w-0 flex-col gap-0.5">
		<h3 id="{uid}-t" class="text-sm font-medium" class:text-muted-foreground={muted}>
			{item.title}
		</h3>
		{#if item.topic}<p class="text-xs text-muted-foreground">{item.topic}</p>{/if}
	</div>
	{#if muted}
		<p role="status" class="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
			<BellOff class="size-3.5 shrink-0" aria-hidden="true" />
			{#if topicMuted}
				You won't see “{item.topic}” again.
			{:else}
				You won't see this again.
			{/if}
		</p>
		<div class="flex min-w-0 flex-wrap gap-2">
			<Button variant="outline" size="sm" onclick={() => onrate?.(null)}>Undo</Button>
			{#if item.topic}
				<Button
					variant="ghost"
					size="sm"
					class="max-w-full whitespace-normal"
					onclick={() => onrate?.({ value: 'down', scope: topicMuted ? 'item' : 'topic' })}
					>{topicMuted ? 'Only this item' : `Mute all “${item.topic}”`}</Button
				>
			{/if}
		</div>
	{:else}
		{#if item.body}<div class="text-ui"><Markdown text={item.body} /></div>{/if}
		{#if answer}
			<p class="text-sm" role="status">
				<span class="text-muted-foreground">You replied:</span>
				{answer}
			</p>
		{/if}
		<div class="flex min-w-0 items-start gap-2">
			<div
				role="group"
				aria-label="Replies to {item.title}"
				class="flex min-w-0 flex-1 flex-wrap gap-2"
			>
				{#if item.url}
					<Button
						variant="outline"
						size="sm"
						href={item.url}
						target="_blank"
						rel="noopener noreferrer">Open<ArrowUpRight data-icon="inline-end" /></Button
					>
				{/if}
				{#each item.choices as choice, index (index)}
					<Button
						variant="outline"
						size="sm"
						class="h-auto min-h-7 max-w-full py-1 text-start whitespace-normal"
						onclick={() => onreply?.(choice, index)}>{choice}</Button
					>
				{/each}
				{#if !replying}
					<Button variant="ghost" size="sm" onclick={openReply}
						><Reply data-icon="inline-start" />Reply</Button
					>
				{/if}
			</div>
			<div role="group" aria-label="Rate {item.title}" class="flex shrink-0 gap-2">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-pressed={rating?.value === 'up'}
					aria-label="Useful"
					title="Useful: flag more like this"
					class="aria-pressed:bg-muted aria-pressed:text-foreground"
					onclick={() => toggle('up')}
					><ThumbsUp class={rating?.value === 'up' ? 'fill-current' : ''} /></Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Not useful"
					title={item.topic
						? `Not useful: stop flagging “${item.topic}”`
						: 'Not useful: stop flagging this'}
					onclick={() => toggle('down')}><ThumbsDown /></Button
				>
			</div>
		</div>
		{#if replying}
			<!-- 24px from the actions on touch: the field has no ::after, so taps near it drift onto a button. -->
			<form class="flex gap-2 any-pointer-coarse:mt-4 any-pointer-coarse:gap-6" onsubmit={submit}>
				<label for="{uid}-a" class="sr-only">Your own reply to {item.title}</label>
				<Input
					id="{uid}-a"
					bind:ref={field}
					bind:value={text}
					placeholder="Write a reply"
					class="min-w-0 flex-1"
					onkeydown={(e) => {
						if (e.key === 'Escape' && !text) replying = false;
					}}
				/>
				<Button type="submit" variant="outline" size="icon" disabled={!text.trim()}
					><SendHorizontal /><span class="sr-only">Send reply</span></Button
				>
			</form>
		{/if}
	{/if}
</section>
