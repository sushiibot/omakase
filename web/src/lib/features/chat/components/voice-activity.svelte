<script lang="ts">
	let { level = 0, muted = false }: { level?: number; muted?: boolean } = $props();
	const value = $derived(muted ? 0 : Math.round(Math.max(0, Math.min(1, level)) * 100));
</script>

<span
	role="meter"
	aria-label={muted ? 'Microphone muted' : 'Microphone level'}
	aria-valuemin="0"
	aria-valuemax="100"
	aria-valuenow={value}
	class="flex h-5 w-5 shrink-0 items-center justify-between gap-0.5"
	title={muted ? 'Microphone muted' : 'Microphone level'}
>
	{#each [0.15, 0.35, 0.55, 0.75] as threshold}
		<span
			aria-hidden="true"
			class="w-1 rounded-full bg-muted-foreground"
			class:!bg-primary={!muted && level >= threshold}
			style:height={`${6 + threshold * 16}px`}
		></span>
	{/each}
</span>
