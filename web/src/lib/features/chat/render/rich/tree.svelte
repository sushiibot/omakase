<script lang="ts">
	import type { RichData } from './blocks';
	import Frame from './frame.svelte';

	// A hierarchy as nested lists with guide lines. Depth is bounded by the schema.
	let { data }: { data: RichData<'tree'> } = $props();
	type Node = RichData<'tree'>['root'];
</script>

{#snippet branch(node: Node)}
	<li class="flex flex-col gap-1">
		<span
			><span class="font-medium">{node.label}</span>{#if node.detail}<span
					class="text-muted-foreground"
				>
					— {node.detail}</span
				>{/if}</span
		>
		{#if node.children?.length}
			<ul class="ml-1 flex flex-col gap-1 border-l pl-3">
				{#each node.children as child, i (i)}{@render branch(child)}{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<Frame title={data.title}>
	<ul class="flex flex-col">{@render branch(data.root)}</ul>
</Frame>
