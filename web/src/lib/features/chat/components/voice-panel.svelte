<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Square from '@lucide/svelte/icons/square';
	import { Button } from '$lib/ui/button';
	import type { SpeechModel, VoiceModel } from '../types';
	import { speechPrice } from '../render/speech-price';
	import { voiceProvider } from '../render/voice-provider';
	import { voiceStatus } from '../render/voice-status';
	import type { ChannelActivity } from '../activity';
	import { voiceTrait } from '../render/voice-traits';
	import { Input } from '$lib/ui/input';
	let {
		models,
		provider,
		loading,
		state: callState,
		error,
		muted,
		agentWorking,
		userText,
		assistantText,
		seconds,
		onprovider,
		onstart,
		onstop,
		onmute,
		onretry,
		onclose,
		mode = 'live',
		speechModels = [],
		speechModel = '',
		speechVoice = '',
		speechDelivery = '',
		ondelivery,
		speechConfigured = false,
		speechError = null,
		pricesUpdatedAt = null,
		turnBusy = false,
		phase = 'listening',
		activity = null,
		previewState = 'idle',
		previewError = null,
		onpreview,
		onmode,
		onspeech,
		onvoice,
		onturn,
		oninterrupt,
		micReady = true
	}: {
		models: VoiceModel[];
		provider: string;
		loading: boolean;
		state: 'idle' | 'connecting' | 'listening' | 'speaking';
		error: string | null;
		muted: boolean;
		agentWorking: boolean;
		userText: string;
		assistantText: string;
		seconds: number;
		onprovider: (id: string) => void;
		onstart: () => void;
		onstop: () => void;
		onmute: () => void;
		onretry: () => void;
		onclose: () => void;
		mode?: 'turns' | 'live';
		speechModels?: SpeechModel[];
		speechModel?: string;
		speechVoice?: string;
		speechDelivery?: string;
		ondelivery?: (value: string) => void;
		speechConfigured?: boolean;
		speechError?: string | null;
		pricesUpdatedAt?: string | null;
		turnBusy?: boolean;
		phase?: string;
		activity?: ChannelActivity | null;
		previewState?: 'idle' | 'loading' | 'playing';
		previewError?: string | null;
		onpreview?: () => void;
		onmode?: (mode: 'turns' | 'live') => void;
		onspeech?: (id: string) => void;
		onvoice?: (voice: string) => void;
		onturn?: () => void;
		oninterrupt?: () => void;
		micReady?: boolean;
	} = $props();
	const active = $derived(callState !== 'idle');
	const selected = $derived(models.find((m) => m.id === provider));
	const speech = $derived(speechModels.find((m) => m.id === speechModel));
	let query = $state('');
	const found = $derived(
		speechModels.filter((m) =>
			`${m.name} ${m.id}`.toLowerCase().includes(query.toLowerCase().trim())
		)
	);
	const canStart = $derived(mode === 'turns' ? speechConfigured && !!speech : selected?.configured);
	const status = $derived(
		voiceStatus({
			state: callState,
			mode,
			muted,
			busy: turnBusy,
			working: agentWorking,
			phase,
			activity,
			request: userText
		})
	);
</script>

<div class="flex flex-col gap-4 p-4">
	<div class="flex items-center justify-between gap-2">
		<h2 class="text-lg font-semibold">Voice chat</h2>
		<Button variant="ghost" onclick={onclose}>Back to chat</Button>
	</div>
	<p class="text-sm text-muted-foreground">
		Sushii uses the same memory, tools and approvals as this chat.
	</p>
	{#if !active}
		<div role="group" aria-label="Voice mode" class="grid grid-cols-2 gap-2">
			<Button
				variant={mode === 'turns' ? 'secondary' : 'outline'}
				class="h-auto min-h-12 px-2 py-2 whitespace-normal"
				aria-pressed={mode === 'turns'}
				disabled={active}
				onclick={() => onmode?.('turns')}>Talk in turns</Button
			>
			<Button
				variant={mode === 'live' ? 'secondary' : 'outline'}
				class="h-auto min-h-12 px-2 py-2 whitespace-normal"
				aria-pressed={mode === 'live'}
				disabled={active}
				onclick={() => onmode?.('live')}>Live conversation</Button
			>
		</div>
		{#if mode === 'turns'}
			<p class="text-sm text-muted-foreground">
				Speak naturally. After a short pause, Sushii sends your turn automatically. Your chosen
				speech model reads the reply. Tap Stop speaking to interrupt.
			</p>
			{#if speech}
				<div class="flex flex-col gap-2">
					<h3 class="font-medium [overflow-wrap:anywhere]">{speech.name}</h3>
					<p class="text-sm text-muted-foreground">
						Speech API: OpenRouter · uses the server’s OpenRouter key
					</p>
					<p class="text-sm text-muted-foreground tabular-nums">{speechPrice(speech)}</p>
					{#if speech.voices.length}
						<label for="speech-voice" class="text-sm font-medium">Speaking voice</label>
						<select
							id="speech-voice"
							class="h-12 w-full rounded-lg border bg-background px-3 text-base"
							value={speechVoice}
							disabled={active || loading}
							onchange={(e) => onvoice?.(e.currentTarget.value)}
						>
							{#each speech.voices as name}<option value={name}
									>{name}{voiceTrait(speech.id, name)
										? ` · ${voiceTrait(speech.id, name)}`
										: ''}</option
								>{/each}
						</select>
					{:else}<p class="text-sm text-muted-foreground">
							This model chooses its default voice.
						</p>{/if}
					{#if speech.capabilities?.expression}
						<label for="speech-delivery" class="text-sm font-medium">Voice delivery</label>
						<Input
							id="speech-delivery"
							class="h-12 text-base"
							value={speechDelivery}
							maxlength={300}
							placeholder="Warm, curious, relaxed pace"
							aria-describedby="speech-delivery-help"
							disabled={active || loading}
							oninput={(e) => ondelivery?.(e.currentTarget.value)}
						/>
						<p id="speech-delivery-help" class="text-xs text-muted-foreground">
							Describe tone, emotion or pacing without brackets. Leave blank for the model’s natural
							delivery. Preview uses these directions too.
						</p>
					{/if}
					{#if speech.capabilities?.streaming}
						<p class="text-sm text-muted-foreground">
							Plays audio as it arrives after the agent finishes its reply.
						</p>
					{/if}
					<Button
						variant="outline"
						class="w-full"
						disabled={active || loading || !speechConfigured}
						onclick={onpreview}
					>
						{#if previewState === 'idle'}<Play aria-hidden="true" /> Preview {speechVoice ||
								'default voice'}{:else}<Square aria-hidden="true" />
							{previewState === 'loading' ? 'Cancel preview' : 'Stop preview'}{/if}
					</Button>
					<p class="text-xs text-muted-foreground">
						Listen before starting a call. The first preview uses a short billed OpenRouter sample;
						replays are cached.
					</p>
					{#if previewState === 'loading'}<p role="status" class="text-sm text-muted-foreground">
							Generating voice preview…
						</p>{/if}
					{#if previewError}<p role="alert" class="text-sm text-failed">{previewError}</p>{/if}
				</div>
			{/if}
			<section aria-label="Curated speech models" class="flex flex-col gap-2">
				<h3 class="text-sm font-medium">Suggested speech models</h3>
				{#each speechModels.filter((m) => m.curated) as model (model.id)}
					<button
						type="button"
						class="flex min-h-12 w-full flex-col gap-1 rounded-lg px-3 py-2 text-left hover:bg-muted disabled:opacity-50 aria-pressed:bg-muted"
						aria-pressed={speechModel === model.id}
						disabled={active || loading}
						onclick={() => onspeech?.(model.id)}
					>
						<span class="text-sm font-medium [overflow-wrap:anywhere]"
							>{model.name} · {model.curated}</span
						>
						<span class="text-sm text-muted-foreground tabular-nums">{speechPrice(model)}</span>
					</button>
				{/each}
			</section>
			<details>
				<summary class="min-h-12 cursor-pointer py-3 font-medium"
					>Browse all OpenRouter speech models</summary
				>
				<div class="flex flex-col gap-2">
					<Input
						class="h-12 text-base"
						type="search"
						aria-label="Search speech models"
						placeholder="Search by name or model ID"
						bind:value={query}
						disabled={active || loading}
					/>
					{#each found as model (model.id)}
						<button
							type="button"
							class="flex min-h-12 w-full flex-col gap-1 rounded-lg px-3 py-2 text-left hover:bg-muted disabled:opacity-50 aria-pressed:bg-muted"
							aria-pressed={speechModel === model.id}
							disabled={active || loading}
							onclick={() => onspeech?.(model.id)}
						>
							<span class="text-sm font-medium [overflow-wrap:anywhere]">{model.name}</span>
							<span class="text-sm [overflow-wrap:anywhere] text-muted-foreground">{model.id}</span>
							<span class="text-sm text-muted-foreground tabular-nums">{speechPrice(model)}</span>
						</button>
					{:else}{#if !loading}<p role="status" class="text-sm text-muted-foreground">
								No speech models match this search.
							</p>{/if}{/each}
				</div>
			</details>
			<p class="text-xs text-muted-foreground">
				OpenRouter catalog prices{pricesUpdatedAt
					? ` · checked ${new Date(pricesUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
					: ''}. Rates vary by provider and may include offers. Transcription and agent usage add
				costs.
			</p>
			{#if !speechConfigured && !loading}<p class="text-sm text-muted-foreground">
					Talk in turns needs an OpenRouter API key on the server.
				</p>{/if}
			{#if speechError}<p role="alert" class="text-sm text-failed">{speechError}</p>
				<Button variant="outline" onclick={onretry}>Retry speech models</Button>{/if}
		{:else}
			<p class="text-sm text-muted-foreground">
				Talk naturally and interrupt anytime. The live model supplies its own voice.
			</p>
			<div class="flex flex-col gap-2">
				<label for="voice-provider" class="text-sm font-medium">Voice model</label>
				<select
					id="voice-provider"
					class="h-12 w-full rounded-lg border bg-background px-3 text-base"
					value={provider}
					disabled={active || loading}
					onchange={(event) => onprovider(event.currentTarget.value)}
				>
					{#if !provider}<option value="">Choose a configured model</option>{/if}
					{#each models as model}
						<option value={model.id} disabled={!model.configured}
							>{model.name} · {voiceProvider(model.provider).name}{model.configured
								? ''
								: ' (not configured)'}</option
						>
					{/each}
				</select>
				{#if selected}
					<p class="text-sm text-muted-foreground">{selected.description}</p>
					<p class="text-sm text-muted-foreground">
						API: {voiceProvider(selected.provider).name}. {selected.configured
							? 'Configured on the server.'
							: 'Not configured.'} Live conversation uses a separate provider key.
					</p>
					<p class="text-xs [overflow-wrap:anywhere] text-muted-foreground">
						Server credential: {voiceProvider(selected.provider).key}
					</p>
					<p class="text-xs text-muted-foreground">
						Audio: ${selected.audioInputUsd} input / ${selected.audioOutputUsd} output per million tokens.
						Text, transcription and agent usage may add costs.
					</p>
				{/if}
			</div>
		{/if}
	{/if}
	{#if active}<div class="flex flex-col gap-1">
			<p role="status" class="font-medium">{status.label}</p>
			<p class="text-sm text-muted-foreground">{status.detail}</p>
			<p class="text-xs text-muted-foreground">
				{mode === 'turns' ? speech?.name : selected?.name} · {mode === 'turns'
					? 'OpenRouter'
					: voiceProvider(selected?.provider ?? '').name} · {Math.floor(seconds / 60)}:{String(
					seconds % 60
				).padStart(2, '0')}
			</p>
		</div>{/if}
	{#if loading}<p role="status" class="text-sm text-muted-foreground">Loading voice models…</p>{/if}
	{#if mode === 'live' && !loading && !models.some((m) => m.configured)}
		<p class="text-sm text-muted-foreground">
			Voice needs a provider API key on the server. Dictation is still available in the composer.
		</p>
	{/if}
	{#if error}<p role="alert" class="text-sm text-failed">{error}</p>{/if}
	{#if active}
		{#if userText}<p class="text-sm"><span class="font-medium">You:</span> {userText}</p>{/if}
		{#if assistantText}<p class="max-h-40 overflow-y-auto text-sm">
				<span class="font-medium">Sushii:</span>
				{assistantText}
			</p>{/if}
		<div class="flex gap-2">
			<Button variant="outline" disabled={callState === 'connecting'} onclick={onmute}
				>{muted ? 'Unmute microphone' : 'Mute microphone'}</Button
			>
			<Button variant="outline" onclick={onstop}>End call</Button>
		</div>
		{#if mode === 'turns'}
			<Button
				disabled={callState === 'connecting' ||
					(callState !== 'speaking' && (turnBusy || muted || !micReady))}
				onclick={callState === 'speaking' ? oninterrupt : onturn}
				>{callState === 'speaking' ? 'Stop speaking' : turnBusy ? 'Working…' : 'Send now'}</Button
			>
		{/if}
		<p class="text-xs text-muted-foreground">
			Use Back to chat for approvals while the call stays open. Calls end when you leave the app or
			after 15 minutes.
		</p>
	{:else}
		<div class="sticky bottom-0 -mx-4 -mb-4 flex gap-2 border-t bg-background p-4">
			<Button class="flex-1" disabled={loading || !canStart} onclick={onstart}
				>Start voice chat</Button
			>
			{#if error || (mode === 'live' && !models.some((m) => m.configured))}<Button
					variant="outline"
					onclick={onretry}>Retry</Button
				>{/if}
		</div>
	{/if}
</div>
