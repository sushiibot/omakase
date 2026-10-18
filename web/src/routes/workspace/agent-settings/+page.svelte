<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Plug from '@lucide/svelte/icons/plug';
	import Mail from '@lucide/svelte/icons/mail';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import * as Item from '$lib/ui/item';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	const connections = [
		{
			href: '/connectors',
			name: 'Connectors',
			description: 'Accounts, MCP servers and API integrations',
			icon: Plug
		},
		{
			href: '/settings/mail',
			name: 'Mail accounts',
			description: 'Connected inboxes and draft access',
			icon: Mail
		},
		{
			href: '/file-stores',
			name: 'File stores',
			description: 'File servers, allowed folders and access permissions',
			icon: FolderOpen
		},
		{
			href: '/settings/permissions',
			name: 'Tool permissions',
			description: 'Review rules and approval requirements',
			icon: ShieldCheck
		}
	];
</script>

<svelte:head><title>Agent settings · sushii</title></svelte:head>
<DetailScreen title="Agent settings" back={{ href: '/workspace', label: 'Workspace' }}>
	<ScreenContent>
		<div class="flex flex-col gap-6">
			<p class="text-sm text-muted-foreground">
				Manage what your agent can access and when it needs your approval.
			</p>
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
