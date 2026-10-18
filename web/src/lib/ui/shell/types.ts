// app: navigation entries the shell renders (ux-guidelines.md#breakpoints)
import type { Component } from 'svelte';

export interface NavItem {
	id: string;
	href: string;
	label: string;
	icon: Component<{ class?: string; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>;
	/** Listed under the entry above it in the sidebar. */
	sub?: boolean;
	/** What is behind it, in one line, where a list has room for it. */
	description?: string;
}

export interface SettingsGroup {
	title: string;
	entries: {
		href: string;
		label: string;
		description: string;
		keywords?: string;
		icon: NavItem['icon'];
	}[];
}
