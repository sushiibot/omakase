<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import { measureClass, type PageMeasure } from '$lib/ui/page';
	import { cn } from '$lib/utils';
	import Screen from './screen.svelte';
	import ScreenState from './screen-state.svelte';
	import SwipeableTabs, { type SwipeableTab } from '../tabs/swipeable-tabs.svelte';

	type ScreenProps = ComponentProps<typeof Screen>;
	type StateProps = Omit<ComponentProps<typeof ScreenState>, 'children'>;

	let {
		tabs,
		value = $bindable(''),
		label,
		onchange,
		lead: leadContent,
		measure = 'reading',
		state,
		hasContent = false,
		children: panelContent,
		...screenProps
	}: Pick<
		ScreenProps,
		| 'title'
		| 'subtitle'
		| 'back'
		| 'breadcrumb'
		| 'level'
		| 'media'
		| 'headerClass'
		| 'actions'
		| 'banner'
		| 'toast'
	> & {
		tabs: readonly SwipeableTab[];
		value?: string;
		label: string;
		onchange?: (value: string) => void;
		lead?: Snippet;
		measure?: PageMeasure;
		state?: StateProps;
		/** Keep the pager mounted while existing content refreshes. */
		hasContent?: boolean;
		children: Snippet<[value: string]>;
	} = $props();

	const effectiveState = $derived(
		state && hasContent && (state.remote.status === 'loading' || state.remote.status === 'error')
			? { ...state, remote: { status: 'ready' as const } }
			: state
	);
	const refreshFailure = $derived(
		state && hasContent && state.remote.status === 'error' ? state : undefined
	);
	const showPager = $derived(
		!effectiveState ||
			(effectiveState.remote.status === 'ready' &&
				!(effectiveState.isEmpty && effectiveState.empty))
	);
</script>

<Screen {...screenProps} {measure} scrollable={false}>
	<div data-tabbed-screen class={cn('flex h-full min-h-0 min-w-0 flex-col', measureClass[measure])}>
		{#if showPager}
			<SwipeableTabs {tabs} bind:value {label} {onchange}>
				{#snippet lead()}
					{#if leadContent}
						<div class="px-4 pt-4 pb-3 md:px-6 md:pt-6">{@render leadContent()}</div>
					{/if}
				{/snippet}
				{#snippet children(panelValue)}
					<div data-tab-content class="min-w-0 px-4 pt-4 pb-12 md:px-6 md:pt-6">
						{@render panelContent(panelValue)}
						{#if refreshFailure}
							<div class="mt-5">
								<ScreenState {...refreshFailure} errorTitle="Couldn't refresh this page.">
									{#snippet children()}{/snippet}
								</ScreenState>
							</div>
						{/if}
					</div>
				{/snippet}
			</SwipeableTabs>
		{:else if effectiveState}
			<div
				class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-4 pb-12 md:px-6 md:pt-6"
			>
				<ScreenState {...effectiveState}>{#snippet children()}{/snippet}</ScreenState>
			</div>
		{/if}
	</div>
</Screen>
