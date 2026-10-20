<script lang="ts">
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import type { RichData } from './blocks';
	import Frame from './frame.svelte';
	import { calendarUrl, eventWhen } from './links';

	// One event with a date tile and an add-to-calendar link built from its fields.
	let { data }: { data: RichData<'event'> } = $props();
	const when = $derived(eventWhen(data.start, data.end));
</script>

<Frame>
	<div class="flex gap-3">
		<div class="flex w-12 shrink-0 flex-col items-center rounded-lg border py-1" aria-hidden="true">
			<span class="text-xs text-failed">{when.month}</span>
			<span class="text-lg font-semibold tabular-nums">{when.day}</span>
		</div>
		<div class="flex min-w-0 flex-col gap-0.5">
			<span class="font-medium">{data.title}</span>
			<span class="text-muted-foreground">{when.text}</span>
			{#if data.location}<span class="flex items-center gap-1 text-muted-foreground"
					><MapPin class="size-3.5 shrink-0" aria-hidden="true" />{data.location}</span
				>{/if}
			{#if data.detail}<span>{data.detail}</span>{/if}
		</div>
	</div>
	<a
		href={calendarUrl(data)}
		target="_blank"
		rel="noopener noreferrer"
		class="flex items-center gap-1.5 self-start text-brand underline"
		><CalendarPlus class="size-4" aria-hidden="true" />Add to Google Calendar</a
	>
</Frame>
