<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from '$lib/ui/button';
	import Screen from '$lib/ui/screen/screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';

	// An address the app doesn't have goes to the chat rather than to a dead end.
	$effect(() => {
		if (page.status === 404) void goto(resolve('/chat'), { replaceState: true });
	});
</script>

<svelte:head><title>sushii</title></svelte:head>

<Screen title="sushii">
	<ScreenContent class="items-start">
		{#if page.status === 404}
			<p role="status" class="text-sm text-muted-foreground">Opening the chat…</p>
		{:else}
			<p role="alert" class="text-sm">
				<span class="font-medium">This screen couldn't open.</span>
				{page.error?.message}
			</p>
			<Button href={resolve('/chat')} variant="outline">Open the chat</Button>
		{/if}
	</ScreenContent>
</Screen>
