<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { ago } from '$lib/ui/format/time';
	import * as Item from '$lib/ui/item';
	import StatePill from '$lib/ui/status/state-pill.svelte';
	import type { SkillSummary } from '../types';

	let { skill, now, href }: { skill: SkillSummary; now: number; href: string } = $props();
</script>

<Item.Root size="sm">
	{#snippet child({ props })}
		<a {href} {...props}>
			<Item.Content class="min-w-0">
				<Item.Title class="line-clamp-none flex-wrap">
					<span class="min-w-0 font-mono [overflow-wrap:anywhere]">{skill.name}</span>
					<StatePill of={skill.stage} />
				</Item.Title>
				<Item.Description>{skill.description}</Item.Description>
				<p class="text-xs text-muted-foreground tabular-nums">
					v{skill.version} · {skill.uses}
					{skill.uses === 1 ? 'run' : 'runs'}{#if skill.lastUsed}
						· last {ago(skill.lastUsed, now)}{/if}
				</p>
			</Item.Content>
			<Item.Actions>
				<ChevronRight class="size-4 text-muted-foreground" aria-hidden="true" />
			</Item.Actions>
		</a>
	{/snippet}
</Item.Root>
