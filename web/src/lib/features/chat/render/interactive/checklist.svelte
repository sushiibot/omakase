<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/ui/button';
	import { Checkbox } from '$lib/ui/checkbox';
	import { Input } from '$lib/ui/input';
	import type { RichData } from '../rich/blocks';
	import Frame from '../rich/frame.svelte';
	import { fingerprint, LIVE_CHECKLIST_MAX, type LiveBinding } from '../rich/live';
	import { loadLocal, saveLocal } from './local-state';

	// A checklist. Bound to a stored block (`live`), it is shared with every device and the agent:
	// ticks, added and removed items all sync. Otherwise ticks stay on this device and the list is
	// as written.
	let {
		data,
		partial = false,
		live
	}: {
		data: RichData<'checklist'>;
		/** Still streaming: items grow and nothing can be ticked yet. */
		partial?: boolean;
		live?: LiveBinding;
	} = $props();
	const uid = $props.id();
	const key = $derived(`checklist:${fingerprint(data)}`);
	let localTicks = $state<Record<number, boolean> | null>(null);
	const ticks = $derived(localTicks ?? loadLocal<Record<number, boolean>>(key, {}));
	const items = $derived(
		live?.block.state.items ??
			data.items.map((item, id) => ({ id, text: item.text, done: ticks[id] ?? item.done }))
	);
	const done = $derived(items.filter((i) => i.done).length);
	let draft = $state('');

	function check(id: number, value: boolean) {
		if (live) return live.apply([{ op: 'check', item: id, done: value }]);
		localTicks = { ...ticks, [id]: value };
		saveLocal(key, localTicks);
	}
	function add(event: SubmitEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (!live || !text) return;
		live.apply([{ op: 'add', text: text.slice(0, 200) }]);
		draft = '';
	}
</script>

<Frame title={data.title}>
	<div class="flex flex-col gap-2">
		<span class="text-xs text-muted-foreground tabular-nums" aria-live="polite"
			>{done} of {items.length} done</span
		>
		<ul class="flex flex-col divide-y">
			{#each items as item (item.id)}
				<li class="group/item flex items-start gap-2.5 py-1.5">
					<Checkbox
						data-rich-control
						class="mt-1"
						aria-labelledby="{uid}-{item.id}"
						disabled={partial}
						checked={item.done}
						onCheckedChange={(v) => check(item.id, v === true)}
					/>
					<span
						id="{uid}-{item.id}"
						class={['min-w-0 flex-1', item.done && 'text-muted-foreground line-through']}
						>{item.text}</span
					>
					{#if live}
						<Button
							data-rich-control
							variant="ghost"
							size="icon-xs"
							aria-label="Remove {item.text}"
							class="text-muted-foreground"
							onclick={() => live.apply([{ op: 'remove', item: item.id }])}><X /></Button
						>
					{/if}
				</li>
			{/each}
		</ul>
		{#if live && items.length < LIVE_CHECKLIST_MAX}
			<form data-rich-control class="flex items-center gap-2" onsubmit={add}>
				<Input
					data-rich-control
					aria-label="Add an item"
					placeholder="Add an item"
					maxlength={200}
					bind:value={draft}
				/>
				<Button
					data-rich-control
					type="submit"
					variant="outline"
					size="icon-sm"
					aria-label="Add"
					disabled={!draft.trim()}><Plus /></Button
				>
			</form>
		{/if}
	</div>
</Frame>
