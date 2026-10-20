<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import { Badge } from '$lib/ui/badge';
	import type { RichData } from './blocks';
	import Frame from './frame.svelte';

	// Options side by side. Scrolls inside its box like a markdown table; the label column stays put.
	let { data }: { data: RichData<'compare'> } = $props();
</script>

<Frame title={data.title}>
	<div class="-mx-4 max-w-none overflow-x-auto px-4">
		<table class="w-full min-w-max border-collapse text-sm">
			<thead>
				<tr>
					<th class="sticky left-0 bg-card"><span class="sr-only">Attribute</span></th>
					{#each data.options as option, i (i)}
						<th
							scope="col"
							class={[
								'px-3 pb-2 text-left align-bottom font-medium',
								option.pick && 'rounded-t-lg bg-muted pt-2'
							]}
						>
							<div class="flex flex-col gap-1">
								{#if option.pick}<Badge variant="secondary">Pick</Badge>{/if}
								<span>{option.name}</span>
								{#if option.note}<span class="text-xs font-normal text-muted-foreground"
										>{option.note}</span
									>{/if}
							</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each data.rows as row, r (r)}
					<tr class="border-t">
						<th
							scope="row"
							class="sticky left-0 bg-card py-2 pr-3 text-left text-xs font-normal text-muted-foreground"
							>{row.label}</th
						>
						{#each row.values as value, i (i)}
							<td
								class={[
									'px-3 py-2 align-top',
									data.options[i]?.pick && 'bg-muted',
									data.options[i]?.pick && r === data.rows.length - 1 && 'rounded-b-lg'
								]}
							>
								{#if value === true}<Check class="size-4 text-review" aria-hidden="true" /><span
										class="sr-only">Yes</span
									>{:else if value === false}<X
										class="size-4 text-muted-foreground"
										aria-hidden="true"
									/><span class="sr-only">No</span>{:else}{value}{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Frame>
