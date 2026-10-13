<script lang="ts" module>
	import type { Component } from 'svelte';

	export interface ListSection<I> {
		label?: string;
		/** Shown before the label. */
		icon?: Component<{ class?: string; 'aria-hidden'?: boolean | 'true' }>;
		/** Classes for the icon, such as a status tone. */
		iconClass?: string;
		/** Show how many items the section holds after its label. */
		count?: boolean;
		items: I[];
	}
</script>

<script lang="ts" generics="T">
	import type { ComponentProps, Snippet } from 'svelte';
	import type { PageMeasure } from '$lib/ui/page';
	import SearchField from '$lib/ui/input/search-field.svelte';
	import { ItemGroup } from '$lib/ui/item';
	import { cn } from '$lib/utils';
	import Section from '$lib/ui/section/section.svelte';
	import Screen from './screen.svelte';
	import ScreenContent from './screen-content.svelte';
	import ScreenState from './screen-state.svelte';

	type ScreenProps = ComponentProps<typeof Screen>;
	type StateProps = ComponentProps<typeof ScreenState>;

	let {
		embedded = false,
		measure = 'reading',
		state,
		sections,
		search = $bindable(),
		searchLabel = 'Search',
		searchInput = $bindable(null),
		lead,
		after,
		tail,
		isEmpty: emptyOverride,
		key,
		row,
		...screenProps
	}: Omit<ScreenProps, 'children' | 'stickToBottom' | 'scroller' | 'footerLayout' | 'measure'> & {
		/** Render inside an existing screen without a header or scroll container. */
		embedded?: boolean;
		measure?: PageMeasure;
		state: Omit<StateProps, 'children' | 'isEmpty'>;
		sections: ListSection<T>[];
		/** Shows a search field when bound. */
		search?: string;
		searchLabel?: string;
		searchInput?: HTMLInputElement | null;
		/** Above the list, whatever its state. */
		lead?: Snippet;
		/** Under the sections once loaded, such as a "load older" button or a note. */
		after?: Snippet;
		/** Content below the list in every loading and empty state. */
		tail?: Snippet;
		/** Overrides "every section is empty", for lists with more to show than their rows. */
		isEmpty?: boolean;
		key: (item: T) => string;
		row: Snippet<[T]>;
	} = $props();

	const uid = $props.id();
	const isEmpty = $derived(emptyOverride ?? sections.every((s) => s.items.length === 0));
</script>

{#snippet content()}
	<ScreenContent {embedded} {measure}>
		{#if search !== undefined}
			<SearchField label={searchLabel} bind:value={search} bind:ref={searchInput} />
		{/if}
		{@render lead?.()}
		<ScreenState {...state} {isEmpty}>
			{#each sections as section, i (section.label ?? i)}
				{#if section.items.length}
					<Section
						title={section.label ?? ''}
						id={`${uid}-s${i}`}
						tone="list"
						count={section.count ? section.items.length : undefined}
					>
						{#snippet icon()}
							{#if section.icon}<section.icon
									class={cn('size-4 shrink-0', section.iconClass)}
									aria-hidden="true"
								/>{/if}
						{/snippet}
						<!-- gap-0 keeps rows that are not an Item contiguous; Item rows set their own gap. -->
						<ItemGroup class="gap-0">
							{#each section.items as item (key(item))}
								<div role="listitem">{@render row(item)}</div>
							{/each}
						</ItemGroup>
					</Section>
				{/if}
			{/each}
			{@render after?.()}
		</ScreenState>
		{@render tail?.()}
	</ScreenContent>
{/snippet}

{#if embedded}
	{@render content()}
{:else}
	<Screen {...screenProps} {measure} footerLayout="page">
		{@render content()}
	</Screen>
{/if}
