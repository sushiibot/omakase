<script lang="ts">
	import type { Snippet } from 'svelte';
	import MessageSquareReply from '@lucide/svelte/icons/message-square-reply';

	// The frame around every control that sends a message as the owner. Dashed and unfilled, with a
	// reply icon and "sends as your message", so it never reads as a decision card: those are filled,
	// carry their own tokens and icon, and act on the server rather than through chat.
	let {
		title,
		live,
		sent,
		children
	}: {
		title?: string;
		/** False outside the latest reply in chat: the controls show but can't send. */
		live: boolean;
		/** What this panel already sent, shown in place of the hint. */
		sent?: string | null;
		children: Snippet;
	} = $props();
</script>

<section data-reply-panel class="my-1 flex flex-col gap-3 rounded-xl border border-dashed p-3">
	<header class="flex items-center gap-1.5 text-xs text-muted-foreground">
		<MessageSquareReply class="size-3.5" aria-hidden="true" />
		<span>{title ?? 'Reply options'}</span>
		<span aria-hidden="true">·</span>
		<span>sends as your message</span>
	</header>
	{@render children()}
	{#if sent}
		<p class="text-xs text-muted-foreground" role="status">Sent “{sent}”</p>
	{:else if !live}
		<p class="text-xs text-muted-foreground">Reply options work in the latest reply.</p>
	{/if}
</section>
