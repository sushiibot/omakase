<!-- app: screen for one record with remote state (ux-guidelines.md#shared-component-patterns) -->
<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import Screen from './screen.svelte';
	import ScreenState from './screen-state.svelte';

	type ScreenProps = ComponentProps<typeof Screen>;
	type StateProps = ComponentProps<typeof ScreenState>;

	let {
		state,
		children,
		...screenProps
	}: Omit<ScreenProps, 'children' | 'stickToBottom' | 'scroller' | 'footerLayout'> & {
		/** Leave out for a screen whose content is always there. */
		state?: Omit<StateProps, 'children'>;
		children: Snippet;
	} = $props();
</script>

<Screen {...screenProps} footerLayout="page">
	{#if state}
		<ScreenState {...state}>{@render children()}</ScreenState>
	{:else}
		{@render children()}
	{/if}
</Screen>
