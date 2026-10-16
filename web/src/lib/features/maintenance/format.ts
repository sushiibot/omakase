/** Provider starts may be local wall-clock times; do not reinterpret them in the device zone. */
export function eventTime(start: string, zone: string | null): string {
	const local = !/(?:Z|[+-]\d{2}:?\d{2})$/.test(start);
	const date = new Date(local ? `${start}Z` : start);
	if (Number.isNaN(date.getTime())) return start;
	try {
		return (
			new Intl.DateTimeFormat(undefined, {
				dateStyle: 'medium',
				timeStyle: 'short',
				timeZone: local ? 'UTC' : (zone ?? 'UTC')
			}).format(date) + (zone ? ` · ${zone.replaceAll('_', ' ')}` : '')
		);
	} catch {
		return start;
	}
}
