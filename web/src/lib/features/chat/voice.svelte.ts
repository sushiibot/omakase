import type { SpeechModel, VoiceModel } from './types';

export class Voice {
	models = $state<VoiceModel[]>([]);
	provider = $state('');
	mode = $state<'turns' | 'live'>('turns');
	speechModels = $state<SpeechModel[]>([]);
	speechModel = $state('');
	speechVoice = $state('');
	speechConfigured = $state(false);
	speechError = $state<string | null>(null);
	pricesUpdatedAt = $state<string | null>(null);
	turnBusy = $state(false);
	#preferencesLoaded = false;
	loading = $state(false);
	state = $state<'idle' | 'connecting' | 'listening' | 'speaking'>('idle');
	error = $state<string | null>(null);
	muted = $state(false);
	agentWorking = $state(false);
	userText = $state('');
	userFinal = $state(false);
	captionsVisible = $state(true);
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
				if (typeof saved?.provider === 'string') this.provider = saved.provider;
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
						this.speechModels.find((m) => m.id === 'hexgrad/kokoro-82m')?.id ??
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
					mode: this.mode,
					provider: this.provider,
					model: this.speechModel,
					voice: this.speechVoice
				})
			);
		} catch {
			/* Optional device preferences. */
		}
	}
	selectSpeech(id: string) {
		this.speechModel = id;
		const voices = this.speechModels.find((m) => m.id === id)?.voices ?? [];
		if (!voices.includes(this.speechVoice)) this.speechVoice = voices[0] ?? '';
		this.persist();
	}
	finishTurn() {
		if (this.mode !== 'turns' || this.state !== 'listening' || this.turnBusy || this.muted) return;
		this.turnBusy = true;
		this.error = null;
		this.#socket?.send(JSON.stringify({ type: 'commit' }));
	}
	interrupt() {
		if (this.mode !== 'turns' || this.state !== 'speaking') return;
		this.#socket?.send(JSON.stringify({ type: 'interrupt' }));
		this.#clearAudio();
		this.state = 'listening';
	}
	async start(conversation: string) {
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
		this.error = null;
		this.userText = this.assistantText = '';
		this.userFinal = this.assistantFinal = false;
		this.#userCommitted = '';
		this.#userItem = undefined;
		this.seconds = 0;
		this.#userFresh = this.#assistantFresh = true;
		this.muted = false;
		this.state = 'connecting';
		const generation = ++this.#generation;
		document.addEventListener('visibilitychange', this.#onhidden);
		this.#timeout = setTimeout(() => this.#fail('Voice connection timed out. Try again.'), 20000);
		try {
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
			for (const track of stream.getAudioTracks())
				track.onended = () => this.#fail('Microphone disconnected. Start a new call.');
			await context.audioWorklet.addModule('/audio/voice-capture.js');
			if (generation !== this.#generation) return;
			const capture = new AudioWorkletNode(context, 'voice-capture', {
				processorOptions: { rate: this.mode === 'turns' ? 16000 : model!.inputRate }
			});
			this.#capture = capture;
			context.createMediaStreamSource(stream).connect(capture);
			const silent = context.createGain();
			silent.gain.value = 0;
			capture.connect(silent).connect(context.destination);
			const url = new URL('/api/voice/connect', location.href);
			url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
			if (this.mode === 'turns') {
				url.searchParams.set('mode', 'turns');
				url.searchParams.set('model', this.speechModel);
				url.searchParams.set('voice', this.speechVoice);
			} else url.searchParams.set('provider', model!.id);
			url.searchParams.set('conversation', conversation);
			const socket = new WebSocket(url);
			this.#socket = socket;
			capture.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
				if (
					generation !== this.#generation ||
					this.state === 'connecting' ||
					(this.mode === 'turns' && (this.turnBusy || this.state !== 'listening' || this.muted)) ||
					socket.readyState !== WebSocket.OPEN
				)
					return;
				if (socket.bufferedAmount > 256 * 1024) {
					this.#fail('Voice connection is too slow. Try again.');
					return;
				}
				const bytes = new Uint8Array(data);
				let binary = '';
				for (const byte of bytes) binary += String.fromCharCode(byte);
				socket.send(JSON.stringify({ type: 'audio', audio: btoa(binary) }));
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
		message?: string;
		state?: string;
	}) {
		switch (event.type) {
			case 'ready':
				if (this.#timer) break;
				if (this.#timeout) clearTimeout(this.#timeout);
				this.#timeout = null;
				this.state = 'listening';
				this.#timer = setInterval(() => this.seconds++, 1000);
				break;
			case 'audio':
				this.#play(event.audio!, event.sampleRate!);
				break;
			case 'audio_encoded':
				void this.#playEncoded(event.audio!);
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
			case 'transcript':
				if (event.role === 'user') {
					const fresh = event.itemId ? event.itemId !== this.#userItem : this.#userFresh;
					if (fresh) this.#userCommitted = '';
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
				break;
			case 'turn_done':
				this.turnBusy = false;
				this.assistantFinal = true;
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
		const generation = this.#generation;
		const context = this.#context;
		if (!context) return;
		try {
			const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
			const buffer = await context.decodeAudioData(bytes.buffer);
			if (generation !== this.#generation) return;
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
	#play(audio: string, rate: number) {
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
			if (!this.#sources.size && this.#socket?.readyState === WebSocket.OPEN)
				this.#socket.send(JSON.stringify({ type: 'playback_idle' }));
			if (!this.#sources.size && this.state === 'speaking') this.state = 'listening';
		};
		const at = Math.max(context.currentTime + 0.02, this.#nextAudio);
		source.start(at);
		this.#nextAudio = at + buffer.duration;
	}
	mute() {
		this.muted = !this.muted;
		for (const track of this.#stream?.getAudioTracks() ?? []) track.enabled = !this.muted;
	}
	#clearAudio() {
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
		++this.#generation;
		document.removeEventListener('visibilitychange', this.#onhidden);
		if (this.#timer) clearInterval(this.#timer);
		if (this.#timeout) clearTimeout(this.#timeout);
		this.#timer = this.#timeout = null;
		this.#socket?.close();
		this.#socket = null;
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
	}
}
