<script lang="ts">
	import ToolIcon from './tool-icon.svelte';
	import ToolDiff from './tool-diff.svelte';
	import { toolPresentation } from '../tool-presentation';
	import { toolCategory } from '../tool-activity';
	import * as Trace from '$lib/ui/trace';
	import * as CodeBlock from '$lib/ui/code-block';
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
	const failed = $derived(step.state === 'failed' && !executionUnknown);
	const lineStatus = $derived(
		step.state === 'running' && !executionUnknown ? 'running' : failed ? 'error' : undefined
	);
	const statusLabel = $derived(
		executionUnknown && approval
			? labels[approval.outcome]
			: step.state === 'running'
				? 'Running'
				: step.state === 'failed'
					? 'Failed'
					: 'Completed'
	);
	const errorPreview = $derived(
		step.state === 'failed' ? step.output?.trim().split('\n').find(Boolean) : undefined
	);
</script>

{#if pending && approval?.outcome === 'pending'}
	<ApprovalInline {pending} {submitting} {onapprove} {ondeny} />
{:else}
	<Trace.Collapsible bind:open data-tool-call={step.id} class="text-ui">
		<Trace.CollapsibleTrigger class="max-w-full">
			<Trace.Line status={lineStatus}>
				<Trace.Icon><ToolIcon kind={toolCategory(step.tool).kind} /></Trace.Icon>
				<Trace.Title class="min-w-16"
					><span class="font-medium" data-tool-label>{presentation.title}</span
					>{#if presentation.detail}
						<span class="font-mono text-code">{presentation.detail}</span>{/if}</Trace.Title
				>
				<Trace.Description class="min-w-0 truncate text-meta">{statusLabel}</Trace.Description>
			</Trace.Line>
		</Trace.CollapsibleTrigger>
		{#if errorPreview}<p
				class="line-clamp-3 ps-6 text-meta [overflow-wrap:anywhere] text-failed"
				data-tool-error
			>
				{errorPreview}
			</p>{/if}
		<Trace.CollapsibleContent hiddenUntilFound>
			<dl class="flex min-w-0 flex-col gap-2 text-meta">
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
					<dt>Tool</dt>
					<dd class="font-mono text-code">{step.tool}</dd>
				</div>
				{#if step.input}<div class="flex flex-col gap-1">
						<dt>Input</dt>
						<dd>
							<CodeBlock.Root size="sm" class="text-code">
								<CodeBlock.Actions>
									<CodeBlock.CopyButton value={presentation.input} label="Copy input" />
								</CodeBlock.Actions>
								<CodeBlock.Content class="max-h-48 pe-11" code={presentation.input} />
							</CodeBlock.Root>
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
				{#if step.output}<div class="flex flex-col gap-1">
						<dt>{step.state === 'failed' ? 'Error details' : 'Result'}</dt>
						<dd>
							<CodeBlock.Root
								size="sm"
								variant={step.state === 'failed' ? 'destructive' : 'default'}
								class="text-code"
							>
								<CodeBlock.Content class="max-h-64" wrap code={step.output} />
							</CodeBlock.Root>
						</dd>
					</div>{/if}
				{#if !step.output && step.state !== 'running' && !executionUnknown}
					<div>
						<dt>Result</dt>
						<dd>No text output was recorded for this call.</dd>
					</div>
				{/if}
			</dl>
		</Trace.CollapsibleContent>
	</Trace.Collapsible>
{/if}
