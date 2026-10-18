<!-- app: flat settings navigation (ux-guidelines.md#shared-component-patterns) -->
<script lang="ts">
	import type { SettingsGroup } from './types';
	import Search from '@lucide/svelte/icons/search';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Input } from '$lib/ui/input';
	import { cn } from '$lib/utils';
	let {
		groups,
		path = '',
		compact = false
	}: { groups: SettingsGroup[]; path?: string; compact?: boolean } = $props();
	let query = $state('');
	const filtered = $derived(
		groups
			.map((group) => ({
				...group,
				entries: group.entries.filter((entry) =>
					`${entry.label} ${entry.description} ${entry.keywords ?? ''}`
						.toLowerCase()
						.includes(query.trim().toLowerCase())
				)
			}))
			.filter((group) => group.entries.length)
	);
	const selected = (href: string) =>
		path === href ||
		(href === '/settings/preferences' && path === '/settings') ||
		(href === '/connectors/mcp' && path.startsWith('/connectors/') && path !== '/connectors/keys');
</script>

<nav
	aria-label="Settings sections"
	class={cn('flex min-w-0 flex-col gap-6', compact && 'min-h-0 flex-1 overflow-y-auto px-3 py-4')}
>
	<div class="relative">
		<Search
			class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
			aria-hidden="true"
		/>
		<Input
			type="search"
			aria-label="Search settings"
			placeholder="Search settings…"
			bind:value={query}
			class="h-12 pl-9"
		/>
	</div>
	{#each filtered as group (group.title)}
		<div class="flex flex-col gap-2">
			<h2 class="px-2 text-sm font-medium text-muted-foreground">{group.title}</h2>
			<ul class="flex flex-col gap-1">
				{#each group.entries as entry (entry.href)}
					<li>
						<a
							href={entry.href}
							aria-current={compact && selected(entry.href) ? 'page' : undefined}
							class={cn(
								'flex min-h-12 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
								compact &&
									selected(entry.href) &&
									'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
							)}
						>
							<entry.icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<span class="min-w-0 flex-1"
								><span class="block font-medium">{entry.label}</span>{#if !compact}<span
										class="mt-0.5 block text-sm text-muted-foreground">{entry.description}</span
									>{/if}</span
							>
							{#if !compact}<ChevronRight
									class="size-4 shrink-0 text-muted-foreground"
									aria-hidden="true"
								/>{/if}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<p role="status" class="px-2 text-sm text-muted-foreground">
			No settings match “{query}”. Try another name.
		</p>
	{/each}
</nav>
