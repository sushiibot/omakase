import type { ChatMessage } from './types';
import { messagePlainText } from './render/plain-text';
import { AudioSessionLease } from './render/audio-session';

/** Speech playback only: shares call settings, never requests a microphone. */
export class ReadAloud {
	messageId = $state<string | null>(null);
	state = $state<'idle' | 'loading' | 'playing'>('idle');
	error = $state<{ id: string; message: string } | null>(null);
	#context: AudioContext | null = null;
	#socket: WebSocket | null = null;
	#epoch = 0;
	#next = 0;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#lease = new AudioSessionLease();
	#hidden = () => {
		if (document.hidden) this.stop();
	};

	stop() {
		++this.#epoch;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = null;
		this.#socket?.close();
		this.#socket = null;
		void this.#context?.close();
		this.#context = null;
		this.#next = 0;
		this.messageId = null;
		this.state = 'idle';
		document.removeEventListener('visibilitychange', this.#hidden);
		this.#lease.restore();
	}
	async start(
		message: ChatMessage,
		settings: () => Promise<{ model: string; voice: string; delivery: string }>
	) {
		const toggle = this.messageId === message.id;
		this.stop();
		this.error = null;
		if (toggle || message.role !== 'assistant' || message.streaming) return;
		const text = messagePlainText(message, location.origin).trim();
		if (!text) return;
		if (text.length > 24000) {
			this.error = {
				id: message.id,
				message: 'This reply is too long to read aloud (24,000 character limit).'
			};
			return;
		}
		this.messageId = message.id;
		this.state = 'loading';
		const epoch = this.#epoch;
		const fail = (reason: string) => {
			if (epoch !== this.#epoch) return;
			this.stop();
			this.error = { id: message.id, message: reason };
		};
		document.addEventListener('visibilitychange', this.#hidden);
		this.#timer = setTimeout(() => fail('Voice playback timed out. Try again.'), 20_000);
		try {
			this.#lease.set('playback');
			// Resume inside the click gesture, before loading settings or connecting.
			const context = new AudioContext();
			this.#context = context;
			await context.resume();
			const selected = await settings();
			if (epoch !== this.#epoch) return;
			const url = new URL('/api/voice/connect', location.href);
			url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
			url.search = new URLSearchParams({ mode: 'read', ...selected }).toString();
			const socket = new WebSocket(url);
			this.#socket = socket;
			socket.onerror = () =>
				fail("Couldn't start read-aloud. Check Voice settings or end any other call.");
			socket.onclose = () => fail('Read-aloud ended before the reply finished. Try again.');
			socket.onmessage = ({ data }) => {
				if (epoch !== this.#epoch) return;
				void (async () => {
					const event = JSON.parse(data);
					if (event.type === 'ready') {
						if (this.#timer) clearTimeout(this.#timer);
						this.#timer = setTimeout(() => fail('Read-aloud reached its time limit.'), 15 * 60_000);
						socket.send(JSON.stringify({ type: 'speak', text }));
					}
					if (event.type === 'error' || event.type === 'notice')
						fail(event.message ?? "Couldn't read this reply.");
					if (event.type === 'turn_done') {
						this.stop();
						return;
					}
					if (event.type !== 'audio' && event.type !== 'audio_encoded') return;
					const bytes = Uint8Array.from(atob(event.audio), (c) => c.charCodeAt(0));
					let buffer: AudioBuffer;
					if (event.type === 'audio_encoded') buffer = await context.decodeAudioData(bytes.buffer);
					else {
						if (event.sampleRate !== 24000 || bytes.length % 2) throw new Error();
						buffer = context.createBuffer(1, bytes.length / 2, event.sampleRate);
						const view = new DataView(bytes.buffer);
						const samples = buffer.getChannelData(0);
						for (let i = 0; i < samples.length; i++)
							samples[i] = view.getInt16(i * 2, true) / 32768;
					}
					if (epoch !== this.#epoch) return;
					if (this.#next - context.currentTime > 5) throw new Error();
					const source = context.createBufferSource();
					source.buffer = buffer;
					source.connect(context.destination);
					source.onended = () => {
						source.disconnect();
						if (epoch !== this.#epoch || socket.readyState !== WebSocket.OPEN) return;
						socket.send(
							JSON.stringify(
								event.type === 'audio'
									? { type: 'playback_done', id: event.playbackId }
									: { type: 'playback_idle' }
							)
						);
					};
					const at = Math.max(this.#next, context.currentTime + 0.02);
					source.start(at);
					this.#next = at + buffer.duration;
					this.state = 'playing';
				})().catch(() => fail("Couldn't play this reply. Try another voice in Voice settings."));
			};
		} catch {
			fail("Couldn't start read-aloud. Check Voice settings and try again.");
		}
	}
}
