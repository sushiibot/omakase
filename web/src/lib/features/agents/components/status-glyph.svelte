<script lang="ts">
	import { cn } from '$lib/utils';
	import { status, type StatusKey, type Tone } from '$lib/ui/status/status';
	let { of, class: className }: { of: StatusKey; class?: string } = $props();
	const tone: Record<Tone, string> = {
		waiting: 'text-waiting',
		running: 'text-running',
		review: 'text-review',
		failed: 'text-failed',
		taint: 'text-taint',
		neutral: 'text-muted-foreground'
	};
	const meta = $derived(status[of]);
</script>

<meta.icon
	class={cn(
		'size-4 shrink-0',
		tone[meta.tone],
		of === 'running' && 'animate-spin motion-reduce:animate-none',
		className
	)}
	aria-hidden="true"
/>
