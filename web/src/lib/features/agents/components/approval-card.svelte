<script lang="ts">
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/ui/button';
	import { SwitchRow } from '$lib/ui/switch';
	import { revealInvisible } from '$lib/ui/format/reveal';
	import { choices, requestKey, requestRisk, requestView } from '../model';
	import type { AgentRecord, AgentRequest, Decision } from '../types';
	let {
		request,
		agent,
		busy = false,
		submitting = false,
		ondecide
	}: {
		request: AgentRequest;
		agent: AgentRecord;
		busy?: boolean;
		/** This request's answer is on its way to the machine. */
		submitting?: boolean;
		ondecide: (decision: Decision) => void;
	} = $props();
	const uid = $props.id();
	let wholeTurn = $state(false);
	const view = $derived(requestView(request));
	const risk = $derived(requestRisk(request));
	// Deny first and Approve widest, as in the chat's approval card.
	const options = $derived(
		choices(request.decisions).sort((a, b) => Number(a.primary) - Number(b.primary))
	);
	let sent = $state<Decision | null>(null);
	const answerable = $derived(request.decisions.includes('accept'));
	const forTurn = $derived(request.decisions.includes('acceptForSession'));
</script>

<section
	data-approval
	data-request={requestKey(request.id)}
	aria-labelledby="{uid}-title"
	class="flex min-w-0 scroll-mt-4 scroll-mb-24 flex-col gap-2 rounded-xl border border-approval/60 bg-approval-surface px-3 py-2"
>
	<header class="flex items-center gap-2">
		<ShieldCheck class="size-4 shrink-0 text-approval" aria-hidden="true" />
		<h3
			id="{uid}-title"
			tabindex="-1"
			class="min-w-0 flex-1 text-ui font-semibold [overflow-wrap:anywhere] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
		>
			{view.title}
		</h3>
		<span class="shrink-0 text-meta text-muted-foreground"
			>{answerable ? 'Approval needed' : 'Needs you'}</span
		>
	</header>
	{#if view.exact}
		<div class="flex flex-col gap-1">
			<p id="{uid}-exact" class="text-meta text-muted-foreground">Exact input</p>
			<pre
				aria-labelledby="{uid}-exact"
				class="max-h-60 overflow-auto rounded-lg border bg-background p-3 font-mono text-code [overflow-wrap:anywhere] whitespace-pre-wrap">{revealInvisible(
					view.exact
				)}</pre>
		</div>
		<p class="text-meta [overflow-wrap:anywhere] text-muted-foreground">
			{#if request.detail?.cwd}In <span class="font-mono"
					>{revealInvisible(request.detail.cwd)}</span
				>{:else if agent.folder}In
				{agent.folder}{/if} on {agent.machineName}
		</p>
		{#if request.detail?.reason}<p class="text-ui [overflow-wrap:anywhere]">
				<span class="text-muted-foreground">Agent's explanation:</span>
				{request.detail.reason}
			</p>{/if}
	{:else}
		<p class="text-ui [overflow-wrap:anywhere] whitespace-pre-wrap">
			{revealInvisible(request.description)}
		</p>
		{#if !answerable}<p class="text-meta text-muted-foreground">
				The app can't send an answer to this request. Decline it and the agent continues without
				one.
			</p>{/if}
	{/if}
	{#if risk}<p class="flex items-start gap-2 text-meta text-taint">
			<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{risk}
		</p>{/if}
	{#if forTurn}<SwitchRow
			checked={wholeTurn}
			disabled={busy}
			onchange={(next) => (wholeTurn = next)}
			class="rounded-lg px-0 py-1.5"
			><span class="text-ui">Also allow matching requests until this turn ends</span><span
				class="text-meta text-muted-foreground">Off: this request only.</span
			></SwitchRow
		>{/if}
	<div class="flex gap-2 any-pointer-coarse:gap-4">
		{#each options as choice (choice.decision)}
			<Button
				variant={choice.primary ? 'default' : 'outline'}
				class={choice.primary ? 'flex-1' : ''}
				data-decision={choice.decision}
				disabled={busy}
				onclick={() => {
					sent = choice.decision;
					ondecide(
						choice.decision === 'accept' && wholeTurn ? 'acceptForSession' : choice.decision
					);
				}}
			>
				{#if submitting && sent === choice.decision}<LoaderCircle
						class="animate-spin motion-reduce:animate-none"
					/>Submitting…{:else if choice.primary}<Check />{choice.label}{:else}<X
					/>{choice.label}{/if}
			</Button>
		{/each}
	</div>
</section>
