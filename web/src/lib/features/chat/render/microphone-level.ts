/** Logarithmic RMS meter: speech stays visible without making low background noise look loud. */
export function microphoneLevel(samples: ArrayLike<number>, scale = 1): number {
	if (!samples.length) return 0;
	let power = 0;
	for (let i = 0; i < samples.length; i++) power += (samples[i]! / scale) ** 2;
	const rms = Math.sqrt(power / samples.length);
	return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 0.00001)) + 55) / 45));
}
