/** Local PCM endpoint detection: retain the start of speech and send after a 1.2s pause. */
export class TurnDetector {
	constructor(private pauseMs = 1200) {}
	private pending: ArrayBuffer[] = [];
	private pendingMs = 0;
	private voicedMs = 0;
	private silentMs = 0;
	private totalMs = 0;
	private active = false;
	reset() {
		this.pending = [];
		this.pendingMs = this.voicedMs = this.silentMs = this.totalMs = 0;
		this.active = false;
	}
	push(pcm: ArrayBuffer): { audio: ArrayBuffer[]; commit: boolean } {
		const samples = new Int16Array(pcm);
		if (!samples.length) return { audio: [], commit: false };
		const ms = samples.length / 16;
		let power = 0;
		for (const sample of samples) power += (sample / 32768) ** 2;
		const voiced = Math.sqrt(power / samples.length) >= (this.active ? 0.008 : 0.012);
		if (!this.active) {
			this.pending.push(pcm);
			this.pendingMs += ms;
			while (this.pendingMs > 400 && this.pending.length > 1)
				this.pendingMs -= this.pending.shift()!.byteLength / 32;
			this.voicedMs = voiced ? this.voicedMs + ms : 0;
			if (this.voicedMs < 120) return { audio: [], commit: false };
			this.active = true;
			this.totalMs = this.pendingMs;
			const audio = this.pending;
			this.pending = [];
			this.pendingMs = 0;
			return { audio, commit: false };
		}
		this.totalMs += ms;
		this.silentMs = voiced ? 0 : this.silentMs + ms;
		const commit = this.silentMs >= this.pauseMs || this.totalMs >= 240_000;
		if (commit) this.reset();
		return { audio: [pcm], commit };
	}
}
