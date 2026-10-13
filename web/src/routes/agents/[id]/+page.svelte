<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { conversationHref } from '$lib/core/nav/conversation';
	import { AgentPage } from '$lib/features/agents';
	const id = $derived(page.params.id ?? '');
	let inApp = false;
	afterNavigate(({ from }) => {
		inApp = !!from?.url;
	});
	// Back returns to where the owner came from; a cold open lands on the agent's conversation.
	function back(conversationId?: string) {
		if (inApp) history.back();
		else void goto(conversationHref(conversationId ?? 'main'), { replaceState: true });
	}
</script>

<svelte:head><title>Agent · sushii</title></svelte:head>
{#key id}<AgentPage {id} focusRequest backLabel="Back to conversation" onback={back} />{/key}
