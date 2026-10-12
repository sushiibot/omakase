import { ReadAloud } from './read-aloud.svelte';
import { microphoneLevel } from './render/microphone-level';
import type { ChatMessage, SpeechModel, VoiceModel } from './types';
import { TurnDetector } from './render/turn-detector';
import { voiceProvider } from './render/voice-provider';
import { LiveTranscription } from './render/live-transcription';
import { voiceMessages, type VoiceTranscript } from './render/voice-messages';
import { AudioSessionLease } from './render/audio-session';

export class Voice {
	reader = new ReadAloud();
	micLevel = $state(0);
	#meterAt = 0;
	async readAloud(message: ChatMessage) {
		if (this.state !== 'idle') return;
		this.stopPreview();
		await this.reader.start(message, async () => {
			if (!this.speechModels.length) await this.load();
			if (!this.speechConfigured) throw new Error('Speech is unavailable');
			return { model: this.speechModel, voice: this.speechVoice, delivery: this.delivery };
		});
	}
	transcripts = $state.raw<VoiceTranscript[]>([]);
	#liveText = new LiveTranscription();
	#captionIndex = -1;
	constructor(private currentMessages: () => ChatMessage[] = () => []) {}
	project(messages: ChatMessage[]): ChatMessage[] {
		return voiceMessages(messages, this.transcripts);
	}
	#beginCaption(clearReply = true) {
		if (clearReply) {
			this.assistantText = '';
			this.assistantFinal = false;
		}
		this.#captionIndex = this.transcripts.length;
		this.transcripts = [
			...this.transcripts,
			{
				id: `voice:${this.#generation}:${this.#captionIndex}`,
				anchors: this.currentMessages().map((m) => m.id),
				userText: '',
				userFinal: false,
				assistantText: '',
				assistantFinal: false
			}
		];
	}
	#syncCaption(link: { userId?: string; assistantId?: string } = {}) {
		if (this.#captionIndex < 0) this.#beginCaption(false);
		this.transcripts = this.transcripts.map((t, i) =>
			i === this.#captionIndex
				? {
						...t,
						userText: this.userText,
						userFinal: this.userFinal,
						assistantText: this.assistantText,
						assistantFinal: this.assistantFinal,
						...link
					}
				: t
		);
	}
	#startLiveText() {
		if (this.mode !== 'turns' || this.muted) return;
		this.#liveText.start((text) => {
			if (this.turnBusy || !this.micReady || !text) return;
			if (this.#userFresh) this.#beginCaption();
			this.#userFresh = false;
			this.userText = text;
			this.userFinal = false;
			this.#syncCaption();
		});
	}
	models = $state<VoiceModel[]>([]);
	provider = $state('');
	mode = $state<'turns' | 'live'>('turns');
	speechModels = $state<SpeechModel[]>([]);
	speechModel = $state('');
	speechVoice = $state('');
	speechDelivery = $state('');
	#speechInterrupted = false;
	#audioEpoch = 0;
	speechConfigured = $state(false);
	speechError = $state<string | null>(null);
	pricesUpdatedAt = $state<string | null>(null);
	turnBusy = $state(false);
	phase = $state<'listening' | 'transcribing' | 'working' | 'synthesizing' | 'resuming'>(
		'listening'
	);
	micReady = $state(false);
	#audioSession = new AudioSessionLease();
	#input: MediaStreamAudioSourceNode | null = null;
	#resumingMic = false;
	previewState = $state<'idle' | 'loading' | 'playing'>('idle');
	previewError = $state<string | null>(null);
	#previewContext: AudioContext | null = null;
	#previewAbort: AbortController | null = null;
	#previewCache = new Map<string, ArrayBuffer>();
	#preferencesLoaded = false;
	turnPause = $state(800);
	#turnDetector = new TurnDetector(800);
	setTurnPause(ms: number) {
		this.turnPause = ms === 1200 ? 1200 : 800;
		this.#turnDetector = new TurnDetector(this.turnPause);
		this.persist();
	}
	loading = $state(false);
	state = $state<'idle' | 'connecting' | 'listening' | 'speaking'>('idle');
	error = $state<string | null>(null);
	muted = $state(false);
	agentWorking = $state(false);
	userText = $state('');
	userFinal = $state(false);
	#userCommitted = '';
	#userItem: string | undefined;
	assistantText = $state('');
	assistantFinal = $state(false);
	seconds = $state(0);
	#socket: WebSocket | null = null;
	#stream: MediaStream | null = null;
	#context: AudioContext | null = null;
	#capture: AudioWorkletNode | null = null;
	#sources = new Set<AudioBufferSourceNode>();
	#nextAudio = 0;
	#userFresh = true;
	#assistantFresh = true;
	#generation = 0;
	#timer: ReturnType<typeof setInterval> | null = null;
	#timeout: ReturnType<typeof setTimeout> | null = null;
	#onhidden = () => {
		if (document.hidden) this.stop();
	};
	get delivery() {
		return this.speechModels.find((m) => m.id === this.speechModel)?.capabilities?.expression
			? this.speechDelivery
			: '';
	}
	setDelivery(value: string) {
		this.stopPreview();
		this.speechDelivery = value.slice(0, 300);
		this.persist();
	}
	get apiLabel() {
		return this.mode === 'turns'
			? 'OpenRouter'
			: `${voiceProvider(this.models.find((m) => m.id === this.provider)?.provider ?? '').shortName} · direct`;
	}
	async load() {
		this.loading = true;
		this.error = null;
		if (!this.#preferencesLoaded) {
			this.#preferencesLoaded = true;
			try {
				const saved = JSON.parse(localStorage.getItem('voice:preferences') ?? 'null');
				if (saved?.mode === 'live' || saved?.mode === 'turns') this.mode = saved.mode;
				if (typeof saved?.model === 'string') this.speechModel = saved.model;
				if (typeof saved?.voice === 'string') this.speechVoice = saved.voice;
				if (typeof saved?.delivery === 'string') this.speechDelivery = saved.delivery.slice(0, 300);
				if (typeof saved?.provider === 'string') this.provider = saved.provider;
				this.turnPause = saved?.turnPause === 1200 ? 1200 : 800;
				this.#turnDetector = new TurnDetector(this.turnPause);
				if (saved?.version !== 2 && this.speechModel === 'hexgrad/kokoro-82m') {
					this.speechModel = this.speechVoice = '';
				}
			} catch {
				/* Storage can be unavailable. */
			}
		}
		const speech = (async () => {
			this.speechError = null;
			try {
				const res = await fetch('/api/voice/speech-models');
				if (!res.ok) throw new Error();
				const body = await res.json();
				this.speechModels = body.models;
				this.speechConfigured = body.configured;
				this.pricesUpdatedAt = body.updatedAt;
				if (!this.speechModels.some((m) => m.id === this.speechModel))
					this.speechModel =
						this.speechModels.find((m) => m.id === 'qwen/qwen-audio-3.0-tts-flash')?.id ??
						this.speechModels[0]?.id ??
						'';
				this.selectSpeech(this.speechModel);
			} catch {
				this.speechError = "Couldn't load OpenRouter speech models. Try again.";
			}
		})();
		try {
			const res = await fetch('/api/voice/models');
			if (!res.ok) throw new Error("Couldn't load voice models. Try again.");
			const body = await res.json();
			this.models = body.models;
			if (!this.models.some((m) => m.id === this.provider && m.configured))
				this.provider = body.defaultProvider ?? '';
		} catch (error) {
			this.error = error instanceof Error ? error.message : "Couldn't load voice models.";
		} finally {
			await speech;
			this.loading = false;
		}
	}
	persist() {
		try {
			localStorage.setItem(
				'voice:preferences',
				JSON.stringify({
					version: 2,
					mode: this.mode,
					provider: this.provider,
					model: this.speechModel,
					voice: this.speechVoice,
					delivery: this.speechDelivery,
					turnPause: this.turnPause
				})
			);
		} catch {
			/* Optional device preferences. */
		}
	}
	selectSpeech(id: string) {
		this.stopPreview();
		this.speechModel = id;
		const voices = this.speechModels.find((m) => m.id === id)?.voices ?? [];
		if (!voices.includes(this.speechVoice)) this.speechVoice = voices[0] ?? '';
		this.persist();
	}
	selectVoice(voice: string) {
		this.stopPreview();
		this.speechVoice = voice;
		this.persist();
	}
	stopPreview() {
		this.#previewAbort?.abort();
		this.#previewAbort = null;
		void this.#previewContext?.close();
		this.#previewContext = null;
		this.previewState = 'idle';
		this.previewError = null;
		if (this.state === 'idle') this.#audioSession.restore();
	}
	async preview() {
		this.reader.stop();
		if (this.previewState !== 'idle') {
			this.stopPreview();
			return;
		}
		if (this.state !== 'idle' || !this.speechConfigured) return;
		this.previewError = null;
		this.previewState = 'loading';
		const abort = new AbortController();
		this.#previewAbort = abort;
		try {
			this.#audioSession.set('playback');
			const context = new AudioContext();
			this.#previewContext = context;
			await context.resume();
			const id = JSON.stringify([this.speechModel, this.speechVoice, this.delivery]);
			let audio = this.#previewCache.get(id);
			if (!audio) {
				const res = await fetch('/api/voice/preview', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						model: this.speechModel,
						voice: this.speechVoice,
						delivery: this.delivery
					}),
					signal: AbortSignal.any([abort.signal, AbortSignal.timeout(65000)])
				});
				if (!res.ok)
					throw new Error(
						(await res.json().catch(() => null))?.error ?? "Couldn't preview this voice."
					);
				audio = await res.arrayBuffer();
				abort.signal.throwIfAborted();
				this.#previewCache.set(id, audio);
				if (this.#previewCache.size > 6)
					this.#previewCache.delete(this.#previewCache.keys().next().value!);
			}
			const buffer = await context.decodeAudioData(audio.slice(0));
			abort.signal.throwIfAborted();
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(context.destination);
			source.onended = () => {
				if (this.#previewAbort === abort) this.stopPreview();
			};
			source.start();
			this.previewState = 'playing';
		} catch (error) {
			if (this.#previewAbort !== abort) return;
			this.stopPreview();
			this.previewError =
				error instanceof Error ? error.message : "Couldn't play this voice preview.";
		}
	}
	finishTurn() {
		if (
			this.mode !== 'turns' ||
			this.state !== 'listening' ||
			!this.micReady ||
			this.turnBusy ||
			this.muted
		)
			return;
		this.#speechInterrupted = false;
		this.turnBusy = true;
		this.phase = 'transcribing';
		this.#pauseMic();
		this.#audioSession.set('playback');
		this.#turnDetector.reset();
		this.error = null;
		this.#socket?.send(JSON.stringify({ type: 'commit' }));
	}
	interrupt() {
		if (this.mode !== 'turns' || this.state !== 'speaking') return;
		this.#speechInterrupted = true;
		this.#socket?.send(JSON.stringify({ type: 'interrupt' }));
		this.#clearAudio();
		this.state = 'listening';
	}
	#pauseMic() {
		this.micLevel = 0;
		this.micReady = false;
		this.#liveText.stop();
		this.#input?.disconnect();
		this.#input = null;
		for (const track of this.#stream?.getTracks() ?? []) {
			track.onended = null;
			track.stop();
		}
		this.#stream = null;
	}
	async #resumeMic() {
		if (this.#resumingMic || !this.#capture || !this.#context) return;
		this.#resumingMic = true;
		const generation = this.#generation;
		this.phase = 'resuming';
		this.#audioSession.set('play-and-record');
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
			});
			if (generation !== this.#generation) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			this.#stream = stream;
			this.micReady = true;
			for (const track of stream.getAudioTracks()) {
				track.enabled = !this.muted;
				track.onended = () => this.#fail('Microphone disconnected. Start a new call.');
			}
			this.#input = this.#context!.createMediaStreamSource(stream);
			this.#input.connect(this.#capture!);
			this.micReady = true;
			this.phase = 'listening';
			this.#startLiveText();
		} catch {
			if (generation === this.#generation)
				this.#fail('Could not resume the microphone. Start a new call.');
		} finally {
			if (generation === this.#generation) this.#resumingMic = false;
		}
	}
	async start(conversation: string) {
		this.reader.stop();
		this.stopPreview();
		if (this.state !== 'idle') return;
		const model = this.models.find((m) => m.id === this.provider && m.configured);
		if (
			this.mode === 'live'
				? !model
				: !this.speechConfigured || !this.speechModels.some((m) => m.id === this.speechModel)
		)
			return;
		this.persist();
		this.turnBusy = false;
		this.#speechInterrupted = false;
		this.error = null;
		this.transcripts = [];
		this.#captionIndex = -1;
		this.userText = this.assistantText = '';
		this.userFinal = this.assistantFinal = false;
		this.#userCommitted = '';
		this.#userItem = undefined;
		this.seconds = 0;
		this.#userFresh = this.#assistantFresh = true;
		this.muted = false;
		this.state = 'connecting';
		const generation = ++this.#generation;
		this.#turnDetector.reset();
		document.addEventListener('visibilitychange', this.#onhidden);
		this.#timeout = setTimeout(() => this.#fail('Voice connection timed out. Try again.'), 20000);
		try {
			this.#audioSession.set('play-and-record');
			// Resume during the user gesture, before any permission or network awaits.
			const context = new AudioContext();
			this.#context = context;
			await context.resume();
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
			});
			if (generation !== this.#generation) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			this.#stream = stream;
			this.micReady = true;
			for (const track of stream.getAudioTracks())
				track.onended = () => this.#fail('Microphone disconnected. Start a new call.');
			await context.audioWorklet.addModule('/audio/voice-capture.js');
			if (generation !== this.#generation) return;
			const capture = new AudioWorkletNode(context, 'voice-capture', {
				processorOptions: { rate: this.mode === 'turns' ? 16000 : model!.inputRate }
			});
			this.#capture = capture;
			this.#input = context.createMediaStreamSource(stream);
			this.#input.connect(capture);
			const silent = context.createGain();
			silent.gain.value = 0;
			capture.connect(silent).connect(context.destination);
			const url = new URL('/api/voice/connect', location.href);
			url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
			if (this.mode === 'turns') {
				url.searchParams.set('mode', 'turns');
				url.searchParams.set('model', this.speechModel);
				url.searchParams.set('voice', this.speechVoice);
				if (this.delivery) url.searchParams.set('delivery', this.delivery);
			} else url.searchParams.set('provider', model!.id);
			url.searchParams.set('conversation', conversation);
			const socket = new WebSocket(url);
			this.#socket = socket;
			capture.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
				if (
					generation !== this.#generation ||
					this.state === 'connecting' ||
					(this.mode === 'turns' &&
						(!this.micReady || this.turnBusy || this.state !== 'listening' || this.muted)) ||
					socket.readyState !== WebSocket.OPEN
				)
					return;
				if (socket.bufferedAmount > 256 * 1024) {
					this.#fail('Voice connection is too slow. Try again.');
					return;
				}
				if (performance.now() - this.#meterAt >= 80) {
					this.micLevel = this.muted ? 0 : microphoneLevel(new Int16Array(data), 32768);
					this.#meterAt = performance.now();
				}
				const turn =
					this.mode === 'turns' ? this.#turnDetector.push(data) : { audio: [data], commit: false };
				for (const pcm of turn.audio) {
					let binary = '';
					for (const byte of new Uint8Array(pcm)) binary += String.fromCharCode(byte);
					socket.send(JSON.stringify({ type: 'audio', audio: btoa(binary) }));
				}
				if (turn.commit) this.finishTurn();
			};
			socket.onmessage = ({ data }) => {
				if (generation !== this.#generation) return;
				try {
					this.#event(JSON.parse(data));
				} catch {
					this.#fail('Voice connection sent an invalid response.');
				}
			};
			socket.onerror = () => {
				if (generation === this.#generation)
					this.#fail("Couldn't start voice. Check your connection and the provider setup.");
			};
			socket.onclose = () => {
				if (generation === this.#generation) this.#fail('Voice call ended. Start a new call.');
			};
		} catch (error) {
			if (generation !== this.#generation) return;
			this.#fail(
				error instanceof DOMException && error.name === 'NotAllowedError'
					? "Allow microphone access in the browser's site settings, then try again."
					: "Couldn't start voice on this device. Try again."
			);
		}
	}
	#event(event: {
		type: string;
		role?: string;
		text?: string;
		final?: boolean;
		replace?: boolean;
		interim?: boolean;
		itemId?: string;
		audio?: string;
		sampleRate?: number;
		playbackId?: number;
		message?: string;
		state?: string;
		userId?: string;
		assistantId?: string;
	}) {
		switch (event.type) {
			case 'ready':
				if (this.#timer) break;
				if (this.#timeout) clearTimeout(this.#timeout);
				this.#timeout = null;
				this.state = 'listening';
				this.#startLiveText();
				this.#timer = setInterval(() => this.seconds++, 1000);
				break;
			case 'audio':
				if (this.#speechInterrupted) break;
				this.#play(event.audio!, event.sampleRate!, event.playbackId);
				break;
			case 'audio_encoded':
				if (this.#speechInterrupted) break;
				void this.#playEncoded(event.audio!);
				break;
			case 'speech_stopped':
				this.#clearAudio();
				if (this.state === 'speaking') this.state = 'listening';
				break;
			case 'notice':
				this.error = event.message ?? 'Try this voice turn again.';
				break;
			case 'interrupted':
				this.#userFresh = true;
				this.#clearAudio();
				this.assistantText = '';
				this.assistantFinal = false;
				this.#assistantFresh = true;
				this.state = 'listening';
				break;
			case 'linked': {
				const existing = this.transcripts.findIndex((t) => t.userId === event.userId);
				const link = {
					userId: event.userId,
					...(event.assistantId ? { assistantId: event.assistantId } : {})
				};
				if (existing >= 0)
					this.transcripts = this.transcripts.map((t, i) =>
						i === existing ? { ...t, ...link } : t
					);
				else this.#syncCaption(link);
				break;
			}
			case 'transcript':
				if (event.role === 'user') {
					const fresh = event.itemId ? event.itemId !== this.#userItem : this.#userFresh;
					if (fresh) {
						this.#beginCaption();
						this.#userCommitted = '';
					}
					this.#userItem = event.itemId;
					this.#userFresh = false;
					if (event.interim) {
						this.userText = ((event.replace ? '' : this.#userCommitted) + (event.text ?? '')).slice(
							-12000
						);
					} else {
						this.#userCommitted = event.replace
							? (event.text ?? '').slice(-12000)
							: (this.#userCommitted + (event.text ?? '')).slice(-12000);
						this.userText = this.#userCommitted;
					}
					this.userFinal = event.final === true;
				} else {
					if (this.#assistantFresh) this.assistantText = '';
					this.#assistantFresh = false;
					this.assistantText = (
						(event.replace ? '' : this.assistantText) + (event.text ?? '')
					).slice(-24000);
					this.assistantFinal = event.final === true;
				}
				this.#syncCaption();
				break;
			case 'phase':
				if (
					event.state === 'transcribing' ||
					event.state === 'working' ||
					event.state === 'synthesizing'
				)
					this.phase = event.state;
				break;
			case 'turn_done':
				this.turnBusy = false;
				if (this.mode === 'turns') {
					this.agentWorking = false;
					void this.#resumeMic();
				}
				this.assistantFinal = true;
				if (this.#captionIndex >= 0) this.#syncCaption();
				this.#userFresh = this.#assistantFresh = true;
				break;
			case 'agent':
				this.agentWorking = event.state === 'working';
				break;
			case 'error':
				this.#fail(event.message ?? 'Voice request failed.');
				break;
		}
	}
	async #playEncoded(audio: string) {
		const epoch = this.#audioEpoch;
		const generation = this.#generation;
		const context = this.#context;
		if (!context) return;
		try {
			const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
			const buffer = await context.decodeAudioData(bytes.buffer);
			if (generation !== this.#generation || epoch !== this.#audioEpoch) return;
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(context.destination);
			this.#sources.add(source);
			this.state = 'speaking';
			source.onended = () => {
				this.#sources.delete(source);
				if (generation === this.#generation) {
					this.state = 'listening';
					this.#socket?.send(JSON.stringify({ type: 'playback_idle' }));
				}
			};
			source.start();
		} catch {
			if (generation === this.#generation)
				this.#fail("Couldn't play this voice. Choose another model or voice.");
		}
	}
	#play(audio: string, rate: number, playbackId?: number) {
		const context = this.#context;
		if (!context || ![16000, 24000, 48000].includes(rate)) return;
		const binary = atob(audio);
		if (binary.length % 2) return;
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		const view = new DataView(bytes.buffer);
		const buffer = context.createBuffer(1, bytes.length / 2, rate);
		const samples = buffer.getChannelData(0);
		for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
		if (this.#nextAudio - context.currentTime > 5) {
			this.#fail('Voice playback fell behind. Start a new call.');
			return;
		}
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.connect(context.destination);
		this.#sources.add(source);
		this.state = 'speaking';
		source.onended = () => {
			this.#sources.delete(source);
			source.disconnect();
			if (playbackId !== undefined && this.#socket?.readyState === WebSocket.OPEN)
				this.#socket.send(JSON.stringify({ type: 'playback_done', id: playbackId }));
			if (!this.#sources.size && this.#socket?.readyState === WebSocket.OPEN)
				this.#socket.send(JSON.stringify({ type: 'playback_idle' }));
			if (!this.#sources.size && this.state === 'speaking') this.state = 'listening';
		};
		const at = this.#nextAudio > context.currentTime ? this.#nextAudio : context.currentTime + 0.02;
		source.start(at);
		this.#nextAudio = at + buffer.duration;
	}
	mute() {
		this.muted = !this.muted;
		this.micLevel = 0;
		if (this.muted) this.#liveText.stop();
		else if (this.micReady) this.#startLiveText();
		this.#turnDetector.reset();
		if (this.mode === 'turns' && !this.turnBusy && this.#socket?.readyState === WebSocket.OPEN)
			this.#socket.send(JSON.stringify({ type: 'clear' }));
		for (const track of this.#stream?.getAudioTracks() ?? []) track.enabled = !this.muted;
	}
	#clearAudio() {
		++this.#audioEpoch;
		for (const source of this.#sources) {
			source.onended = null;
			source.stop();
			source.disconnect();
		}
		this.#sources.clear();
		this.#nextAudio = 0;
	}
	#fail(message: string) {
		this.stop();
		this.error = message;
	}
	stop() {
		this.reader.stop();
		this.stopPreview();
		++this.#generation;
		this.#turnDetector.reset();
		document.removeEventListener('visibilitychange', this.#onhidden);
		if (this.#timer) clearInterval(this.#timer);
		if (this.#timeout) clearTimeout(this.#timeout);
		this.#timer = this.#timeout = null;
		this.#socket?.close();
		this.#socket = null;
		this.#pauseMic();
		this.#resumingMic = false;
		this.#capture?.disconnect();
		this.#capture = null;
		for (const track of this.#stream?.getTracks() ?? []) {
			track.onended = null;
			track.stop();
		}
		this.#stream = null;
		this.#clearAudio();
		void this.#context?.close();
		this.#context = null;
		this.agentWorking = false;
		this.turnBusy = false;
		this.muted = false;
		this.state = 'idle';
		this.phase = 'listening';
		this.#audioSession.restore();
	}
}
