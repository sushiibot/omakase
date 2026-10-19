<script lang="ts">
	import * as Trace from '$lib/ui/trace';
	import * as CodeBlock from '$lib/ui/code-block';
	import { untrack } from 'svelte';
	import Terminal from '@lucide/svelte/icons/terminal';
	import FilePen from '@lucide/svelte/icons/file-pen';
	import Wrench from '@lucide/svelte/icons/wrench';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import { workSummary, type Turn, type WorkItem } from '../model';
	let { turn, number, now }: { turn: Turn; number: number; now: number } = $props();
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
	<CodeBlock.Root size="sm" class="text-code">
		<CodeBlock.Content class="max-h-60" code={text} />
	</CodeBlock.Root>
{/snippet}

<Trace.Collapsible bind:open data-work-group>
	<Trace.CollapsibleTrigger aria-label="Turn {number} work: {summary.text}" class="max-w-full">
		<Trace.Line status={!turn.end ? 'running' : summary.failed ? 'error' : undefined}>
			<Trace.Title>{summary.text}</Trace.Title>
		</Trace.Line>
	</Trace.CollapsibleTrigger>
	<Trace.CollapsibleContent hiddenUntilFound>
		<Trace.Root role="list" class="text-ui">
			{#each turn.work as item, index (index)}
				<div role="listitem" class="min-w-0">
					{#if item.kind === 'command'}
						<Trace.Collapsible>
							<Trace.CollapsibleTrigger class="max-w-full">
								<Trace.Line
									status={runningCommand(item, index)
										? 'running'
										: item.exitCode || item.failed
											? 'error'
											: undefined}
								>
									<Trace.Icon><Terminal /></Trace.Icon>
									<Trace.Title class="font-mono text-code">{item.command}</Trace.Title>
									{#if runningCommand(item, index)}<Trace.Description class="text-meta"
											>Running</Trace.Description
										>{:else if item.exitCode !== undefined}<Trace.Description class="text-meta"
											>exit {item.exitCode}</Trace.Description
										>{:else if item.failed}<Trace.Description class="text-meta"
											>Failed</Trace.Description
										>{/if}
								</Trace.Line>
							</Trace.CollapsibleTrigger>
							<Trace.CollapsibleContent hiddenUntilFound>
								<div class="flex min-w-0 flex-col gap-2">
									<CodeBlock.Root size="sm" class="text-code">
										<CodeBlock.Actions>
											<CodeBlock.CopyButton value={item.command} label="Copy command" />
										</CodeBlock.Actions>
										<CodeBlock.Content class="pe-11" code="$ {item.command}" />
									</CodeBlock.Root>
									{#if item.outputTail}{@render output(item.outputTail)}{:else}<p class="text-meta">
											No output.
										</p>{/if}
								</div>
							</Trace.CollapsibleContent>
						</Trace.Collapsible>
					{:else if item.kind === 'fileChange'}
						<div class="flex min-w-0 items-start gap-2 py-1 text-muted-foreground">
							<Trace.Icon class="mt-0.5"><FilePen /></Trace.Icon>
							<ul class="flex min-w-0 flex-1 flex-col gap-1">
								{#each item.files as file, f (f)}<li class="min-w-0 [overflow-wrap:anywhere]">
										<span>{change[file.change]}</span>
										<span class="font-mono text-code text-foreground">{file.path}</span
										>{#if file.movePath}<span> → </span><span
												class="font-mono text-code text-foreground">{file.movePath}</span
											>{/if}
									</li>{/each}
								{#if item.more}<li class="text-meta">
										{item.more} more files
									</li>{/if}
							</ul>
							{#if item.failed}<span class="shrink-0 text-meta text-failed">Failed</span>{/if}
						</div>
					{:else if item.kind === 'tool'}
						<Trace.Collapsible>
							<Trace.CollapsibleTrigger class="max-w-full">
								<Trace.Line status={item.failed ? 'error' : undefined}>
									<Trace.Icon><Wrench /></Trace.Icon>
									<Trace.Title
										>{item.name}{#if item.detail}<span> · {item.detail}</span>{/if}</Trace.Title
									>
									{#if item.failed}<Trace.Description class="text-meta">Failed</Trace.Description
										>{/if}
								</Trace.Line>
							</Trace.CollapsibleTrigger>
							<Trace.CollapsibleContent hiddenUntilFound>
								<div class="flex min-w-0 flex-col gap-2">
									{#if item.detail}<p class="font-mono text-code [overflow-wrap:anywhere]">
											{item.detail}
										</p>{/if}
									{#if item.outputTail}{@render output(item.outputTail)}{:else}<p class="text-meta">
											No output.
										</p>{/if}
								</div>
							</Trace.CollapsibleContent>
						</Trace.Collapsible>
					{:else if item.kind === 'approval'}
						<Trace.Line class="any-pointer-coarse:min-h-11">
							<Trace.Icon><UserCheck /></Trace.Icon>
							<Trace.Title>{item.title ?? 'Approval'}</Trace.Title>
							<Trace.Description class="text-meta">{decided[item.status]}</Trace.Description>
						</Trace.Line>
					{:else if item.kind === 'message'}
						<p class="flex min-w-0 items-start gap-2 py-1 text-muted-foreground">
							<Trace.Icon class="mt-0.5"><MessageSquare /></Trace.Icon>
							<span class="min-w-0 flex-1 [overflow-wrap:anywhere] whitespace-pre-wrap"
								>{item.text}</span
							>
						</p>
					{/if}
				</div>
			{/each}
		</Trace.Root>
	</Trace.CollapsibleContent>
</Trace.Collapsible>
