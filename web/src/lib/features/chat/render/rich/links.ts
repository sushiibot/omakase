// Links a rich block offers that the model never writes: built here from validated fields, so the
// host is always a fixed https origin and every value is URL-encoded.

const pad = (n: number) => String(n).padStart(2, '0');

interface Parts {
	y: number;
	m: number;
	d: number;
	hh?: number;
	mm?: number;
}

/** `2026-10-19` or `2026-10-19T18:30` (already validated) as numbers. */
export function dateParts(value: string): Parts {
	const [date, time] = value.split('T');
	const [y, m, d] = date.split('-').map(Number);
	if (!time) return { y, m, d };
	const [hh, mm] = time.split(':').map(Number);
	return { y, m, d, hh, mm };
}

/** UTC carries the wall-clock fields unchanged: the event is in the owner's own time. */
const asUtc = (p: Parts) => new Date(Date.UTC(p.y, p.m - 1, p.d, p.hh ?? 0, p.mm ?? 0));

const stamp = (date: Date, withTime: boolean) =>
	`${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
	(withTime ? `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00` : '');

/** A Google Calendar "add event" link. No zone suffix, so the calendar reads it as local time. */
export function calendarUrl(e: {
	title: string;
	start: string;
	end?: string;
	location?: string;
	detail?: string;
}): string {
	const start = dateParts(e.start);
	const timed = start.hh !== undefined;
	const from = asUtc(start);
	let to: Date;
	if (e.end) {
		to = asUtc(dateParts(e.end));
		// All-day ends are exclusive.
		if (!timed) to = new Date(to.getTime() + 86_400_000);
	} else {
		to = new Date(from.getTime() + (timed ? 3_600_000 : 86_400_000));
	}
	const params = new URLSearchParams({
		action: 'TEMPLATE',
		text: e.title,
		dates: `${stamp(from, timed)}/${stamp(to, timed)}`
	});
	if (e.location) params.set('location', e.location);
	if (e.detail) params.set('details', e.detail);
	return `https://calendar.google.com/calendar/render?${params}`;
}

export function mapsUrl(p: { name: string; address?: string }): string {
	const query = p.address ? `${p.name}, ${p.address}` : p.name;
	return `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query })}`;
}

const DAY = new Intl.DateTimeFormat('en-US', {
	weekday: 'short',
	month: 'short',
	day: 'numeric',
	year: 'numeric',
	timeZone: 'UTC'
});
const TIME = new Intl.DateTimeFormat('en-US', {
	hour: 'numeric',
	minute: '2-digit',
	timeZone: 'UTC'
});
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** `Tue, Nov 3, 2026 · 3:30 – 4:00 PM`-style text for an event's dates. */
export function eventWhen(
	start: string,
	end?: string
): { month: string; day: number; text: string } {
	const s = dateParts(start);
	const from = asUtc(s);
	const timed = s.hh !== undefined;
	let text = DAY.format(from);
	if (timed) text += ` · ${TIME.format(from)}`;
	if (end) {
		const e = dateParts(end);
		const to = asUtc(e);
		const sameDay = e.y === s.y && e.m === s.m && e.d === s.d;
		if (timed)
			text += sameDay ? ` – ${TIME.format(to)}` : ` – ${DAY.format(to)} · ${TIME.format(to)}`;
		else if (!sameDay) text += ` – ${DAY.format(to)}`;
	}
	return { month: MONTH.format(from), day: s.d, text };
}
