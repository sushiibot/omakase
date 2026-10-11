<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	let {
		checked,
		disabled = false,
		label,
		onchange
	}: { checked: boolean; disabled?: boolean; label: string; onchange: () => void } = $props();
</script>

<span class="relative flex size-12 shrink-0 items-center justify-center">
	<input
		type="checkbox"
		class="peer absolute inset-0 size-12 cursor-pointer opacity-0 disabled:cursor-default"
		aria-label={label}
		{checked}
		{disabled}
		{onchange}
	/>
	<span
		class="pointer-events-none flex size-5 items-center justify-center rounded border border-muted-foreground bg-background peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-disabled:opacity-50"
		>{#if checked}<Check class="size-4 text-primary-foreground" aria-hidden="true" />{/if}</span
	>
</span>
