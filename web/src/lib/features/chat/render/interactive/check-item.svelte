<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Checkbox } from '$lib/ui/checkbox';
	import { loadLocal, saveLocal } from './local-state';

	// A task-list item the owner can tick. Ticks stay on this device, keyed by the list's text; the
	// agent's own [x] is the starting state.
	let {
		listId,
		index,
		initial,
		children
	}: { listId: string; index: number; initial: boolean; children: Snippet } = $props();
	const uid = $props.id();
	const key = $derived(`check:${listId}`);
	// The tick set here this session, else the saved one, else the agent's.
	let local = $state<boolean | null>(null);
	const checked = $derived(local ?? loadLocal<Record<number, boolean>>(key, {})[index] ?? initial);

	function change(value: boolean) {
		local = value;
		const saved = loadLocal<Record<number, boolean>>(key, {});
		saved[index] = value;
		saveLocal(key, saved);
	}
</script>

<div class="flex items-start gap-2.5">
	<Checkbox
		data-rich-control
		id={uid}
		class="mt-1"
		aria-labelledby="{uid}-label"
		{checked}
		onCheckedChange={(v) => change(v === true)}
	/>
	<div
		id="{uid}-label"
		class={['flex min-w-0 flex-1 flex-col gap-1', checked && 'text-muted-foreground line-through']}
	>
		{@render children()}
	</div>
</div>
