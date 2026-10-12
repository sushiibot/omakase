export interface Recognition {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onresult:
		| ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void)
		| null;
	onerror: ((event: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	abort(): void;
}
export type RecognitionConstructor = new () => Recognition;
/** Interim display only. Recorded-audio transcription remains authoritative for sending. */
export class LiveTranscription {
	constructor(
		private constructorFor = (): RecognitionConstructor | undefined => {
			const api = window as Window & {
				SpeechRecognition?: RecognitionConstructor;
				webkitSpeechRecognition?: RecognitionConstructor;
			};
			return api.SpeechRecognition ?? api.webkitSpeechRecognition;
		}
	) {}
	private recognition: Recognition | null = null;
	private restart: ReturnType<typeof setTimeout> | null = null;
	start(ontext: (text: string) => void): boolean {
		this.stop();
		const Constructor = this.constructorFor();
		if (!Constructor) return false;
		try {
			const recognition = new Constructor();
			this.recognition = recognition;
			recognition.continuous = true;
			recognition.interimResults = true;
			recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
			let prefix = '';
			let latest = '';
			let restarts = 0;
			recognition.onresult = (event) => {
				if (this.recognition !== recognition) return;
				const text = Array.from(event.results, (r) => r[0].transcript)
					.join(' ')
					.trim();
				latest = `${prefix} ${text}`.trim().slice(0, 12000);
				ontext(latest);
			};
			recognition.onerror = () => {
				if (this.recognition === recognition) this.stop();
			};
			recognition.onend = () => {
				if (this.recognition !== recognition) return;
				if (restarts++ >= 8) return this.stop();
				prefix = latest;
				this.restart = setTimeout(() => {
					this.restart = null;
					if (this.recognition !== recognition) return;
					try {
						recognition.start();
					} catch {
						this.stop();
					}
				}, 100);
			};
			recognition.start();
			return true;
		} catch {
			this.stop();
			return false;
		}
	}
	stop() {
		if (this.restart) clearTimeout(this.restart);
		this.restart = null;
		const recognition = this.recognition;
		this.recognition = null;
		if (!recognition) return;
		recognition.onresult = recognition.onerror = recognition.onend = null;
		try {
			recognition.abort();
		} catch {
			/* Already ended. */
		}
	}
}
