import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
import KeyRound from '@lucide/svelte/icons/key-round';
import Plug from '@lucide/svelte/icons/plug';
import Mail from '@lucide/svelte/icons/mail';
import FolderOpen from '@lucide/svelte/icons/folder-open';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import type { SettingsGroup } from '$lib/ui/shell/types';

export const settingsGroups: SettingsGroup[] = [
	{
		title: 'Personal',
		entries: [
			{
				href: '/settings/preferences',
				label: 'Preferences',
				description: 'Your name, appearance, notifications and this device',
				keywords: 'theme dark light push folders app version install',
				icon: SlidersHorizontal
			}
		]
	},
	{
		title: 'Agent access',
		entries: [
			{
				href: '/accounts',
				label: 'Website accounts',
				description: 'Saved passwords and access history',
				keywords: 'credentials login vault audit',
				icon: KeyRound
			},
			{
				href: '/settings/mail',
				label: 'Mail accounts',
				description: 'Connected inboxes and draft access',
				keywords: 'email gmail outlook',
				icon: Mail
			},
			{
				href: '/connectors/keys',
				label: 'API integrations',
				description: 'Service keys and connection status',
				keywords: 'tokens credentials secrets maps',
				icon: KeyRound
			},
			{
				href: '/connectors/mcp',
				label: 'MCP servers',
				description: 'Servers that provide tools to your agent',
				keywords: 'connectors integrations',
				icon: Plug
			},
			{
				href: '/file-stores',
				label: 'File stores',
				description: 'File servers, allowed folders and access',
				keywords: 'storage webdav sftp files',
				icon: FolderOpen
			},
			{
				href: '/settings/permissions',
				label: 'Tool permissions',
				description: 'Rules for when the agent needs approval',
				keywords: 'security allow deny access',
				icon: ShieldCheck
			}
		]
	}
];

export function isSettingsPath(path: string): boolean {
	return (
		path === '/settings' ||
		path.startsWith('/settings/') ||
		path === '/accounts' ||
		path === '/file-stores' ||
		path === '/connectors' ||
		path.startsWith('/connectors/') ||
		path === '/workspace/agent-settings'
	);
}
