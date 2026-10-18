import House from '@lucide/svelte/icons/house';
import PanelsTopLeft from '@lucide/svelte/icons/panels-top-left';
import ListChecks from '@lucide/svelte/icons/list-checks';
import Activity from '@lucide/svelte/icons/activity';
import BookMarked from '@lucide/svelte/icons/book-marked';
import CalendarClock from '@lucide/svelte/icons/calendar-clock';
import Globe from '@lucide/svelte/icons/globe';
import History from '@lucide/svelte/icons/history';
import MessagesSquare from '@lucide/svelte/icons/messages-square';
import FolderOpen from '@lucide/svelte/icons/folder-open';
import Plug from '@lucide/svelte/icons/plug';
import Settings from '@lucide/svelte/icons/settings';
import Sparkles from '@lucide/svelte/icons/sparkles';
import Sunrise from '@lucide/svelte/icons/sunrise';
import type { NavItem } from '$lib/ui/shell/types';
import type { ClientFeature } from '../features.svelte';

/** Live navigation, with optional fixture previews. */
export interface NavEntry extends NavItem {
	feature?: ClientFeature;
}

/** Which fixture previews are visible; the prototype passes `allOn`. */
export type FeatureCheck = (feature: ClientFeature | undefined) => boolean;
export const allOn: FeatureCheck = () => true;

const assistant: NavEntry = { id: 'assistant', href: '/assistant', label: 'Home', icon: House };

const chats: NavEntry = {
	id: 'chats',
	href: '/chats',
	label: 'Channels',
	icon: MessagesSquare
};

/** The More screen, top to bottom. */
const moreEntries: NavEntry[] = [
	{
		id: 'artifacts',
		href: '/artifacts',
		label: 'Artifacts',
		icon: BookMarked,
		description: 'Saved reports and documents'
	},
	{
		id: 'tasks',
		href: '/tasks',
		label: 'Tasks',
		icon: ListChecks,
		description: 'Your to-dos, checklists and delegated work'
	},
	{
		id: 'briefing',
		href: '/briefing',
		label: 'Briefing',
		icon: Sunrise,
		feature: 'briefing',
		description: "This morning's briefing, with sources"
	},
	{
		id: 'runs',
		href: '/runs',
		label: 'Activity',
		icon: Activity,
		description: 'Execution records, delegated agents and scheduled runs'
	},
	{
		id: 'history',
		href: '/history',
		label: 'History',
		icon: History,
		description: "The agent's notes by day, and search across chat and notes"
	},
	{
		id: 'memory',
		href: '/memory',
		label: 'Memory',
		icon: BookMarked,
		description: 'What the agent remembers, and every change to it'
	},
	{
		id: 'skills',
		href: '/skills',
		label: 'Skills',
		icon: Sparkles,
		feature: 'skills',
		description: 'How-tos the agent wrote for itself, and their versions'
	},
	{
		id: 'schedules',
		href: '/schedules',
		label: 'Schedules',
		icon: CalendarClock,
		feature: 'schedules',
		description: 'Jobs that run on their own, and how each run went'
	},
	{
		id: 'connectors',
		href: '/connectors',
		label: 'Connectors',
		icon: Plug,
		description: 'Accounts, MCP servers and API integrations'
	},
	{
		id: 'file-stores',
		href: '/file-stores',
		label: 'File stores',
		icon: FolderOpen,
		description: 'File servers, allowed folders and access permissions'
	},
	{
		id: 'browser',
		href: '/browser',
		label: 'Browser',
		icon: Globe,
		feature: 'browser',
		description: "Watch the agent's browser, or take it over to sign in"
	},
	{
		id: 'agent-settings',
		href: '/workspace/agent-settings',
		label: 'Agent settings',
		icon: Settings,
		description: 'Connections, file access and tool permissions'
	},
	{
		id: 'settings',
		href: '/settings',
		label: 'App settings',
		icon: Settings,
		description: 'Notifications, theme and this device'
	}
];

/** Live screens plus the fixture previews enabled on this device. */
export function moreFor(on: FeatureCheck): NavEntry[] {
	return moreEntries.filter((e) => !e.feature || on(e.feature));
}

const workspace: NavEntry = {
	id: 'workspace',
	href: '/workspace',
	label: 'Workspace',
	icon: PanelsTopLeft,
	description: 'Memory, history, file stores, connectors and workspace tools'
};

/** Information and capabilities, rather than frequently used work destinations. */
export function workspaceFor(on: FeatureCheck): NavEntry[] {
	const entries = moreFor(on);
	return [
		'artifacts',
		'memory',
		'history',
		'agent-settings',
		'briefing',
		'skills',
		'schedules',
		'browser'
	].flatMap((id) => entries.filter((entry) => entry.id === id));
}

/** Stable primary destinations. Optional previews live inside Workspace. */
export function navFor(_on: FeatureCheck): NavEntry[] {
	return [
		assistant,
		chats,
		moreEntries.find((entry) => entry.id === 'tasks')!,
		moreEntries.find((entry) => entry.id === 'runs')!,
		workspace,
		moreEntries.find((entry) => entry.id === 'settings')!
	];
}

const pathOf = (routeId: string) => routeId.replace(/\/\([^)]+\)/g, '') || '/';
const sectionOf = (path: string) => path.match(/^\/[^/]+/)?.[0];

/** The nav entry a route belongs to, which the drawer and sidebar light. */
export function activeNav(routeId: string | null): string | undefined {
	if (!routeId) return undefined;
	const section = sectionOf(pathOf(routeId));
	if (section === '/chat' || section === '/inbox') return 'chats';
	if (
		section === '/workspace' ||
		section === '/more' ||
		section === '/connectors' ||
		section === '/accounts' ||
		section === '/file-stores' ||
		pathOf(routeId).startsWith('/settings/mail') ||
		pathOf(routeId).startsWith('/settings/permissions')
	)
		return 'workspace';
	const entry = [assistant, chats, ...moreEntries].find((e) => e.href === section);
	return entry && workspaceFor(allOn).some((item) => item.id === entry.id)
		? 'workspace'
		: entry?.id;
}
