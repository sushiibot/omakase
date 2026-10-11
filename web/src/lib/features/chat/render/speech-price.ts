import type { SpeechModel } from '../types';

const usd = (n: number) =>
	`$${Number(n.toPrecision(6)).toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
export function speechPrice(model: SpeechModel): string {
	const { unit, input, output } = model.price;
	if (unit === 'seconds')
		return output === null ? 'Price unavailable' : `${usd(output)} / generated second`;
	if (unit === 'characters')
		return input === null ? 'Price unavailable' : `${usd(input * 1_000_000)} / 1M characters`;
	return `${input === null ? 'Unknown' : usd(input * 1_000_000)} text input / ${output === null ? 'unknown' : usd(output * 1_000_000)} audio output per 1M tokens`;
}
