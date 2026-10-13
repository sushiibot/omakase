<script lang="ts">
	import { Button } from '$lib/ui/button';
	import { Spinner } from '$lib/ui/spinner';
	import { untrack } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import Terminal from '@lucide/svelte/icons/terminal';
	import FilePen from '@lucide/svelte/icons/file-pen';
	import Wrench from '@lucide/svelte/icons/wrench';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import { cn } from '$lib/utils';
	import { workSummary, type Turn, type WorkItem } from '../model';
	let { turn, number, now }: { turn: Turn; number: number; now: number } = $props();
	const uid = $props.id();
	const summary = $derived(workSummary(turn, now));
	// Open while the turn runs or when something in it failed; the owner's choice holds after that.
	let open = $state(untrack(() => !turn.end || workSummary(turn, now).failed > 0));
	let ended = $state(untrack(() => !!turn.end));
	$effect(() => {
		if (turn.end && !ended) {
			ended = true;
			if (!summary.failed) open = false;
		}
	});
	const change = {
		add: 'Added',
		delete: 'Deleted',
		update: 'Changed',
		unknown: 'Unknown change to'
	} as const;
	const decided = {
		pending: 'Waiting for you',
		accepted: 'Approved',
		declined: 'Denied',
		cancelled: 'Cancelled',
		withdrawn: 'No longer needed'
	} as const;
	const runningCommand = (i: WorkItem, index: number) =>
		!turn.end &&
		i.kind === 'command' &&
		i.exitCode === undefined &&
		!i.outputTail &&
		index === turn.work.length - 1;
</script>

{#snippet output(text: string)}
	<pre
		class="max-h-60 overflow-auto rounded-lg border bg-muted/30 p-2 font-mono text-code whitespace-pre">{text}</pre>
{/snippet}

<div class="flex min-w-0 flex-col gap-2" data-work-group>
	<Button
		variant="ghost"
		aria-expanded={open}
		aria-controls="{uid}-work"
		aria-label="Turn {number} work: {summary.text}"
		onclick={() => (open = !open)}
		class="w-full min-w-0 shrink justify-start gap-2 px-0 text-left font-normal text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground dark:hover:bg-transparent"
	>
		{#if !turn.end}<Spinner
				role="presentation"
				aria-hidden="true"
				class="shrink-0 text-running motion-reduce:animate-none"
			/>{:else if summary.failed}<CircleX
				class="size-4 shrink-0 text-failed"
				aria-hidden="true"
			/>{/if}
		<span class="min-w-0 flex-1 truncate">{summary.text}</span>
		<ChevronDown
			class={cn(
				'size-4 shrink-0 transition-transform motion-reduce:transition-none',
				open && 'rotate-180'
			)}
			aria-hidden="true"
		/>
	</Button>
	<ol id="{uid}-work" hidden={!open} class="flex min-w-0 flex-col gap-1 border-l pl-3">
		{#each turn.work as item, index (index)}
			<li class="min-w-0 text-ui">
				{#if item.kind === 'command'}
					<details class="group/item min-w-0">
						<summary
							class="flex min-h-8 cursor-pointer list-none items-center gap-2 any-pointer-coarse:min-h-12 [&::-webkit-details-marker]:hidden"
						>
							<Terminal class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<code class="min-w-0 flex-1 truncate font-mono text-code">{item.command}</code>
							{#if runningCommand(item, index)}<span
									class="flex shrink-0 items-center gap-1 text-meta text-running"
									><Spinner
										role="presentation"
										aria-hidden="true"
										class="size-3.5 motion-reduce:animate-none"
									/>Running</span
								>{:else if item.exitCode !== undefined}<span
									class={cn(
										'shrink-0 text-meta tabular-nums',
										item.exitCode ? 'text-failed' : 'text-muted-foreground'
									)}>exit {item.exitCode}</span
								>{:else if item.failed}<span class="shrink-0 text-meta text-failed">Failed</span
								>{/if}
						</summary>
						<div class="flex min-w-0 flex-col gap-2 pb-2">
							<pre
								class="overflow-x-auto font-mono text-code [overflow-wrap:anywhere] whitespace-pre-wrap">$ {item.command}</pre>
							{#if item.outputTail}{@render output(item.outputTail)}{:else}<p
									class="text-meta text-muted-foreground"
								>
									No output.
								</p>{/if}
						</div>
					</details>
				{:else if item.kind === 'fileChange'}
					<div
						class="flex min-h-8 min-w-0 items-start gap-2 py-1.5 any-pointer-coarse:min-h-12 any-pointer-coarse:py-3"
					>
						<FilePen class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<ul class="flex min-w-0 flex-1 flex-col gap-1">
							{#each item.files as file, f (f)}<li class="min-w-0 [overflow-wrap:anywhere]">
									<span class="text-muted-foreground">{change[file.change]}</span>
									<span class="font-mono text-code">{file.path}</span>{#if file.movePath}<span
											class="text-muted-foreground"
										>
											→
										</span><span class="font-mono text-code">{file.movePath}</span>{/if}
								</li>{/each}
							{#if item.more}<li class="text-meta text-muted-foreground">
									{item.more} more files
								</li>{/if}
						</ul>
						{#if item.failed}<span class="shrink-0 text-meta text-failed">Failed</span>{/if}
					</div>
				{:else if item.kind === 'tool'}
					<details class="min-w-0">
						<summary
							class="flex min-h-8 cursor-pointer list-none items-center gap-2 any-pointer-coarse:min-h-12 [&::-webkit-details-marker]:hidden"
						>
							<Wrench class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<span class="min-w-0 flex-1 truncate"
								>{item.name}{#if item.detail}<span class="text-muted-foreground">
										· {item.detail}</span
									>{/if}</span
							>
							{#if item.failed}<span class="shrink-0 text-meta text-failed">Failed</span>{/if}
						</summary>
						<div class="flex min-w-0 flex-col gap-2 pb-2">
							{#if item.detail}<p class="font-mono text-code [overflow-wrap:anywhere]">
									{item.detail}
								</p>{/if}
							{#if item.outputTail}{@render output(item.outputTail)}{:else}<p
									class="text-meta text-muted-foreground"
								>
									No output.
								</p>{/if}
						</div>
					</details>
				{:else if item.kind === 'approval'}
					<p
						class="flex min-h-8 min-w-0 items-center gap-2 text-muted-foreground any-pointer-coarse:min-h-12"
					>
						<UserCheck class="size-4 shrink-0" aria-hidden="true" />
						<span class="min-w-0 flex-1 truncate">{item.title ?? 'Approval'}</span>
						<span class="shrink-0 text-meta">{decided[item.status]}</span>
					</p>
				{:else if item.kind === 'message'}
					<p class="flex min-w-0 items-start gap-2 py-2 text-muted-foreground">
						<MessageSquare class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
						<span class="min-w-0 flex-1 [overflow-wrap:anywhere] whitespace-pre-wrap"
							>{item.text}</span
						>
					</p>
				{/if}
			</li>
		{/each}
	</ol>
</div>
