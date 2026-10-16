<!-- app: screen for one record with remote state (ux-guidelines.md#shared-component-patterns) -->
<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import Screen from './screen.svelte';
	import ScreenState from './screen-state.svelte';

	type ScreenProps = ComponentProps<typeof Screen>;
	type StateProps = ComponentProps<typeof ScreenState>;

	let {
		state,
		hasContent = false,
		children,
		...screenProps
	}: Omit<ScreenProps, 'children' | 'stickToBottom' | 'scroller' | 'footerLayout'> & {
		/** Leave out for a screen whose content is always there. */
		state?: Omit<StateProps, 'children'>;
		/** Keep existing content mounted during a background refresh. */
		hasContent?: boolean;
		children: Snippet;
	} = $props();
	const effectiveState = $derived(
		state && hasContent && (state.remote.status === 'loading' || state.remote.status === 'error')
			? { ...state, remote: { status: 'ready' as const } }
			: state
	);
</script>

<Screen {...screenProps} footerLayout="page">
	{#if effectiveState}
		<ScreenState {...effectiveState}>{@render children()}</ScreenState>
	{:else}
		{@render children()}
	{/if}
	{#if hasContent && state?.remote.status === 'error'}
		<ScreenState {...state}>{#snippet children()}{/snippet}</ScreenState>
	{/if}
</Screen>
