import { untrack } from 'svelte';
import type { BrowserPreview } from '$lib/features/browser';
import { Dictation } from './dictation.svelte';
import type { ChatStore } from './store.svelte';
import type { ModelsStore } from './models.svelte';

/** Bind during component initialization. Getters follow topic navigation in a reused route. */
export function conversationMedia(options: {
	conversationId: () => string;
	store: () => ChatStore | null;
	browser: () => BrowserPreview;
	expanded: () => boolean;
}) {
	const dictation = new Dictation((text, send) => {
		const store = options.store();
		if (!store) return;
		const draft = store.draft.trimEnd();
		store.setDraft(draft ? `${draft} ${text}` : text);
		if (send) void store.send(store.draft);
	});
	$effect(() => {
		options.conversationId();
		return () => dictation.cancel();
	});
	$effect(() => {
		const preview = options.browser();
		return untrack(() => preview.start());
	});
	$effect(() => {
		const preview = options.browser();
		const expanded = options.expanded();
		untrack(() => preview.setExpanded(expanded));
	});
	return dictation;
}

/** Own the model watch and context refresh triggers for the currently displayed conversation. */
export function conversationContext(options: {
	store: () => ChatStore | null;
	models: () => ModelsStore;
	sheet: () => string | undefined;
}) {
	const revision = $derived.by(() => {
		const store = options.store();
		return `${store?.running}:${JSON.stringify(store?.usage)}:${store?.items.findLast((i) => i.kind === 'divider')?.id}:${store?.items.findLast((i) => i.kind === 'assistant')?.id}`;
	});
	$effect(() => {
		const models = options.models();
		untrack(() => void models.remote.ensure());
		return models.remote.watch();
	});
	$effect(() => {
		revision;
		const models = options.models();
		untrack(() => models.refresh());
	});
	$effect(() => {
		const sheet = options.sheet();
		if (sheet !== 'model' && sheet !== 'context') return;
		const models = options.models();
		untrack(() => models.refresh());
	});
	$effect(() => {
		const models = options.models();
		const timer = setInterval(() => {
			const sheet = options.sheet();
			if (
				!document.hidden &&
				(options.store()?.running || sheet === 'model' || sheet === 'context')
			)
				models.refresh();
		}, 15_000);
		return () => clearInterval(timer);
	});
}
