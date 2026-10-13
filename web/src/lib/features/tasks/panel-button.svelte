<script lang="ts">
	import ListTodo from '@lucide/svelte/icons/list-todo';
	import { Button } from '$lib/ui/button';
	let {
		count,
		waiting,
		open,
		onclick
	}: {
		/** Open tasks in this conversation. */
		count: number;
		/** Agent requests waiting on the owner, counted by request. */
		waiting: number;
		open: boolean;
		onclick: () => void;
	} = $props();
</script>

<Button
	variant="ghost"
	class="min-w-12 gap-1 px-2"
	aria-label="Tasks, {count} open{waiting
		? `. Agents: ${waiting} ${waiting === 1 ? 'request needs' : 'requests need'} you`
		: ''}"
	aria-expanded={open}
	{onclick}
	><ListTodo class="size-5" /><span class="text-sm">{count || 'Tasks'}</span>{#if waiting}<span
			data-agents-waiting
			class="size-2 rounded-full bg-waiting"
			aria-hidden="true"
		></span>{/if}</Button
>
