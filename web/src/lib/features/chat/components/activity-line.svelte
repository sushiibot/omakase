<script lang="ts">
	import { Button } from '$lib/ui/button';
	import type { ChannelActivity } from '../activity';
	let { activity, onreview }: { activity: ChannelActivity | null; onreview?: () => void } =
		$props();
</script>

<div
	data-channel-activity
	class="flex min-h-6 items-center gap-2 px-4 text-meta text-muted-foreground"
>
	{#if activity}
		{#if activity.kind === 'thinking' || activity.kind === 'typing'}
			<span aria-hidden="true" class="activity-dots flex shrink-0 items-center gap-1"
				><i></i><i></i><i></i></span
			>
		{/if}
		<p data-typing role="status" class="min-w-0 flex-1 truncate">{activity.label}</p>
		{#if activity.request && onreview}<Button variant="ghost" onclick={onreview}>Review</Button
			>{/if}
	{/if}
</div>

<style>
	.activity-dots i {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: currentColor;
	}
	@media (prefers-reduced-motion: no-preference) {
		.activity-dots i {
			animation: activity-pulse 1.2s ease-in-out infinite;
		}
		.activity-dots i:nth-child(2) {
			animation-delay: 0.15s;
		}
		.activity-dots i:nth-child(3) {
			animation-delay: 0.3s;
		}
	}
	@keyframes activity-pulse {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}
</style>
