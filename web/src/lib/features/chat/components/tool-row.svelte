<script lang="ts">
	import { Spinner } from '$lib/ui/spinner';
	import ToolIcon from './tool-icon.svelte';
	import ToolDiff from './tool-diff.svelte';
	import { toolPresentation } from '../tool-presentation';
	import { toolCategory } from '../tool-activity';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import * as Collapsible from '$lib/ui/collapsible';
	import DisclosureTrigger from '$lib/ui/collapsible/disclosure-trigger.svelte';
	import ApprovalInline from './approval-inline.svelte';
	import type { TurnStep, PendingApproval, ApprovalOutcome } from '../types';
	import type { LocationReply } from '../location';
	let {
		step,
		approval,
		approvalReason,
		pending,
		submitting = false,
		open = $bindable(false),
		focused = false,
		executionUnknown = false,
		onapprove,
		ondeny
	}: {
		step: TurnStep;
		approvalReason?: string;
		approval?: { tool: string; outcome: ApprovalOutcome; nonce?: string };
		pending?: PendingApproval;
		submitting?: boolean;
		open?: boolean;
		focused?: boolean;
		executionUnknown?: boolean;
		onapprove?: (nonce: string, location?: LocationReply) => void;
		ondeny?: (nonce: string) => void;
	} = $props();
	$effect(() => {
		if (focused) open = true;
	});
	const labels: Record<ApprovalOutcome, string> = {
		pending: 'Approval needed',
		approved: 'Approved',
		denied: 'Denied',
		timeout: 'Expired',
		cancelled: 'Cancelled',
		'approved-elsewhere': 'Approved on another device',
		'denied-elsewhere': 'Denied on another device'
	};
	const presentation = $derived(toolPresentation(step.tool, step.input, step.label));
	const errorPreview = $derived(
		step.state === 'failed' ? step.output?.trim().split('\n').find(Boolean) : undefined
	);
</script>

{#if pending && approval?.outcome === 'pending'}
	<ApprovalInline {pending} {submitting} {onapprove} {ondeny} />
{:else}
	<Collapsible.Root
		bind:open
		data-tool-call={step.id}
		class="min-w-0 text-ui text-muted-foreground"
	>
		<DisclosureTrigger class="py-1">
			<ToolIcon kind={toolCategory(step.tool).kind} />
			{#if step.state === 'failed'}<CircleX
					class="size-4 shrink-0 text-failed"
					aria-hidden="true"
				/>{/if}
			<span class="min-w-0 flex-1 py-1">
				<span class="block font-medium [overflow-wrap:anywhere] text-foreground" data-tool-label
					>{presentation.title}</span
				>
				{#if presentation.detail}<span class="line-clamp-2 block text-meta [overflow-wrap:anywhere]"
						>{presentation.detail}</span
					>{/if}
				<span
					class="flex flex-wrap items-center gap-1 text-meta"
					class:text-failed={step.state === 'failed' && !executionUnknown}
				>
					{#if step.state === 'running'}<Spinner decorative class="size-3.5" />{/if}
					<span
						>{executionUnknown && approval
							? labels[approval.outcome]
							: step.state === 'running'
								? 'Running'
								: step.state === 'failed'
									? 'Failed'
									: 'Completed'}</span
					>
					<span aria-hidden="true"> · </span>{open ? 'Hide details' : 'View details'}
				</span>
				{#if errorPreview}<span
						class="mt-1 line-clamp-3 block text-meta [overflow-wrap:anywhere] text-failed"
						>{errorPreview}</span
					>{/if}
			</span>
		</DisclosureTrigger>
		<Collapsible.Content hiddenUntilFound>
			<dl class="flex min-w-0 flex-col gap-2 border-t py-2 text-meta">
				{#if approval}<div>
						<dt class="sr-only">Decision</dt>
						<dd data-approval-record>
							{labels[approval.outcome]}{approval.outcome.startsWith('approved')
								? executionUnknown
									? ' · Execution status unavailable'
									: ' · Permission granted for this call'
								: ''}
						</dd>
					</div>{/if}
				{#if approvalReason}<div>
						<dt>Why approval was requested</dt>
						<dd class="whitespace-pre-wrap">{approvalReason}</dd>
					</div>{/if}
				<div>
					<dt class="text-muted-foreground">Tool</dt>
					<dd class="font-mono text-code">{step.tool}</dd>
				</div>
				{#if step.input}<div>
						<dt>Input</dt>
						<dd>
							<pre
								class="max-h-48 overflow-auto font-mono text-code [overflow-wrap:anywhere] whitespace-pre-wrap">{presentation.input}</pre>
						</dd>
					</div>{/if}
				{#if step.diff}<div>
						<dt class="sr-only">File changes</dt>
						<dd><ToolDiff diff={step.diff} /></dd>
					</div>
				{:else if step.tool === 'edit' && step.state === 'ok'}<div>
						<dt class="sr-only">File changes</dt>
						<dd>Diff was not recorded for this call.</dd>
					</div>{/if}
				{#if step.output}<div>
						<dt>{step.state === 'failed' ? 'Error details' : 'Result'}</dt>
						<dd>
							<pre
								class="max-h-64 overflow-auto font-mono text-code [overflow-wrap:anywhere] whitespace-pre-wrap">{step.output}</pre>
						</dd>
					</div>{/if}
				{#if !step.output && step.state !== 'running' && !executionUnknown}
					<div>
						<dt>Result</dt>
						<dd>No text output was recorded for this call.</dd>
					</div>
				{/if}
			</dl>
		</Collapsible.Content>
	</Collapsible.Root>
{/if}
