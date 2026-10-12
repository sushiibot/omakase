/** Audio-session hints are optional; the OS still owns hardware volume and output routing. */
export class AudioSessionLease {
	constructor(
		private read = () => (navigator as Navigator & { audioSession?: { type: string } }).audioSession
	) {}
	private original: string | undefined;
	private owned: string | undefined;
	set(type: 'playback' | 'play-and-record') {
		const session = this.read();
		if (!session) return;
		try {
			this.original ??= session.type;
			session.type = type;
			this.owned = type;
		} catch {
			/* Unsupported session types must not prevent a call. */
		}
	}
	restore() {
		const session = this.read();
		try {
			if (session && session.type === this.owned && this.original) session.type = this.original;
		} catch {
			/* Platform may have taken over the session. */
		}
		this.original = this.owned = undefined;
	}
}
