<script lang="ts">
	import { resolve } from '$app/paths';
	import { DiscussionPicker, HomeScreen } from '$lib/features/home';
	import type { Inbox } from './inbox.svelte';

	let {
		inbox,
		threads,
		inspector = false
	}: { inspector?: boolean; inbox: Inbox; threads: { id: string; title: string }[] } = $props();
	const home = $derived(inbox.home);
	const data = $derived(inbox.data);
</script>

{#snippet discussion()}
	<DiscussionPicker
		embedded={inspector}
		conversations={threads}
		busy={inbox.discussionBusy}
		error={inbox.discussionError}
		onchoose={(id) => void inbox.chooseConversation(id)}
		oncreate={(title) => void inbox.chooseConversation('', title)}
		onback={() => inbox.stopDiscussing()}
	/>
{/snippet}

<HomeScreen
	{inspector}
	embedded
	sheetOnly
	groups={home.groups}
	remote={inbox.remote}
	partError={inbox.greeted && data.status === 'error' ? data.error : null}
	partLoading={inbox.greeted && data.status === 'loading' && data.slow}
	workspace={data.data?.workspace.state ?? 'online'}
	connection={inbox.connection}
	now={inbox.now}
	peek={inbox.peek}
	peekContent={inbox.discussing ? discussion : undefined}
	peekLabel={inbox.discussing ? 'Discuss in a conversation' : undefined}
	onopen={(id) => {
		home.clearResult(id);
		inbox.sheet.openWith(id);
	}}
	onclose={() => inbox.sheet.close()}
	onretry={() => void data.refetch()}
	ondecide={(nonce, d, location) => void home.decide(nonce, d, location)}
	onanswer={(askId, answer, index) => void home.answer(askId, answer, index)}
	ondismiss={(id) => {
		void home.dismiss(id);
		inbox.sheet.close();
	}}
	ondone={inbox.done}
	onreply={inbox.discuss}
	onreplyitem={(item, key, text, index) => void home.reply(item, key, text, index)}
	answers={home.answers}
	onrateitem={(item, key, rating) => void home.rate(item, key, rating)}
	ratings={home.ratings}
	onopenrun={(id) => void inbox.leaveTo(resolve('/runs/[id]', { id }))}
	onopenchat={inbox.openChat}
	onaskagent={inbox.discuss}
/>
