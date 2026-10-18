<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Plug from '@lucide/svelte/icons/plug';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import * as Item from '$lib/ui/item';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	const connections = [
		{
			href: '/connectors/mcp',
			name: 'MCP servers',
			description: 'Connect servers that provide tools to your agent.',
			icon: Plug
		},
		{
			href: '/connectors/keys',
			name: 'API integrations',
			description: 'Let the agent guide setup. Save service keys securely.',
			icon: KeyRound
		}
	];
</script>

<svelte:head><title>Connectors · sushii</title></svelte:head>
<DetailScreen title="Connectors" back={{ href: '/workspace', label: 'Workspace' }}>
	<ScreenContent>
		<div class="flex flex-col gap-6">
			<p class="text-sm text-muted-foreground">Manage the services and tools your agent can use.</p>
			<Item.Group>
				{#each connections as connection (connection.href)}
					<Item.Root>
						{#snippet child({ props })}
							<a {...props} href={connection.href}>
								<Item.Media variant="icon"><connection.icon aria-hidden="true" /></Item.Media>
								<Item.Content
									><Item.Title>{connection.name}</Item.Title><Item.Description
										>{connection.description}</Item.Description
									></Item.Content
								>
								<Item.Actions><ChevronRight class="size-4" aria-hidden="true" /></Item.Actions>
							</a>
						{/snippet}
					</Item.Root>
				{/each}
			</Item.Group>
		</div>
	</ScreenContent>
</DetailScreen>
