<script lang="ts">
	import Mic from '@lucide/svelte/icons/mic';
	import MicOff from '@lucide/svelte/icons/mic-off';
	import PhoneOff from '@lucide/svelte/icons/phone-off';
	import Square from '@lucide/svelte/icons/square';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import { Button } from '$lib/ui/button';
	import type { ChannelActivity } from '../activity';
	import { voiceStatus } from '../render/voice-status';
	let {
		state,
		muted,
		agentWorking,
		error,
		onmute,
		onstop,
		ondetails,
		mode = 'live',
		turnBusy = false,
		phase = 'listening',
		activity = null,
		request = '',
		onreview,
		oninterrupt
	}: {
		state: 'idle' | 'connecting' | 'listening' | 'speaking';
		muted: boolean;
		agentWorking: boolean;
		error: string | null;
		onmute: () => void;
		onstop: () => void;
		ondetails: () => void;
		mode?: 'live' | 'turns';
		turnBusy?: boolean;
		phase?: string;
		activity?: ChannelActivity | null;
		request?: string;
		onreview?: () => void;
		oninterrupt?: () => void;
		seconds?: number;
		apiLabel?: string;
		onturn?: () => void;
	} = $props();
	const status = $derived(
		voiceStatus({
			state,
			mode,
			muted,
			busy: turnBusy,
			working: agentWorking,
			phase,
			activity,
			request
		})
	);
</script>

{#if state !== 'idle'}
	<section aria-label="Voice call" class="shrink-0 border-t bg-muted/30 px-2 py-1">
		<div class="flex items-center gap-2">
			<Button
				variant="ghost"
				class="h-auto min-h-12 min-w-0 flex-1 justify-start gap-2 px-2 py-1 text-left"
				aria-label={status.review ? 'Review voice request in chat' : 'Voice call details'}
				onclick={status.review ? onreview : ondetails}
			>
				<span class="min-w-0 flex-1">
					<span role="status" class="block truncate text-sm font-medium">{status.label}</span>
					<span class="block truncate text-xs font-normal text-muted-foreground"
						>{status.detail}</span
					>
				</span>
				<ChevronUp class="size-4 shrink-0" aria-hidden="true" />
			</Button>
			<Button
				variant="ghost"
				class="size-12 shrink-0 px-0"
				aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
				aria-pressed={muted}
				disabled={state === 'connecting'}
				onclick={onmute}
			>
				{#if muted}<MicOff aria-hidden="true" />{:else}<Mic aria-hidden="true" />{/if}
			</Button>
			{#if mode === 'turns' && state === 'speaking'}<Button
					variant="ghost"
					class="size-12 shrink-0 px-0"
					aria-label="Stop speaking"
					onclick={oninterrupt}><Square aria-hidden="true" /></Button
				>{/if}
			<Button
				variant="destructive"
				class="size-12 shrink-0 px-0"
				aria-label="End call"
				onclick={onstop}><PhoneOff aria-hidden="true" /></Button
			>
		</div>
		{#if error}<p role="alert" class="px-2 pb-2 text-sm text-failed">{error}</p>{/if}
	</section>
{:else if error}
	<div class="flex items-center justify-between gap-2 border-t px-3 py-1">
		<p role="alert" class="text-sm text-failed">{error}</p>
		<Button variant="ghost" onclick={ondetails}>Voice settings</Button>
	</div>
{/if}
