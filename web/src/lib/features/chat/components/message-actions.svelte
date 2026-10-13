<script lang="ts" module>
	import type { Component } from 'svelte';

	export interface MessageAction {
		id: string;
		label: string;
		icon: Component<{ class?: string; 'aria-hidden'?: boolean | 'true' }>;
		onclick: () => void;
		loading?: boolean;
	}
</script>

<script lang="ts">
	import { Button } from '$lib/ui/button';
	import { Spinner } from '$lib/ui/spinner';
	import { cn } from '$lib/utils';

	let {
		actions,
		label,
		always = false,
		align = 'start',
		pending = false,
		beside = false
	}: {
		actions: MessageAction[];
		/** The group's accessible name, saying whose message it acts on. */
		label: string;
		/** Shown even on a hover-capable device before hover or focus, as under the latest reply. */
		always?: boolean;
		align?: 'start' | 'end';
		/** Holds the row's space, hidden, while the reply streams, so it appears without moving text. */
		pending?: boolean;
		/** With a mouse, sits beside the message's left edge instead of under it, taking no height. */
		beside?: boolean;
	} = $props();
</script>

<!-- Transparent rather than removed until hover or focus, so revealing it never moves the list. -->
<div
	role="group"
	aria-label={label}
	class={cn(
		// Pulled up into the gap above, so the icons sit right under the text.
		'-mt-2 flex h-12 items-center gap-2',
		align === 'end' ? '-mr-1.5 justify-end self-end' : '-ml-1.5',
		!always &&
			'transition-opacity duration-(--duration-short) group-focus-within/msg:opacity-100 group-hover/msg:opacity-100 [@media(hover:hover)]:opacity-0',
		pending && 'invisible',
		beside &&
			'[@media(hover:hover)]:absolute [@media(hover:hover)]:right-full [@media(hover:hover)]:bottom-0 [@media(hover:hover)]:m-0'
	)}
>
	{#each actions as a (a.id)}
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={a.label}
			title={a.label}
			onclick={a.onclick}
			data-loading={a.loading || undefined}
			class="rounded-full text-muted-foreground"
		>
			{#if a.loading}
				<Spinner role="presentation" aria-hidden="true" class="motion-reduce:animate-none" />
			{:else}
				<a.icon aria-hidden="true" />
			{/if}
		</Button>
	{/each}
</div>
