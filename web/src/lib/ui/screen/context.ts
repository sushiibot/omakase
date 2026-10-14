// app: measure shared by a screen and its content and footer (ux-guidelines.md#shared-component-patterns)
import { getContext, setContext } from 'svelte';
import type { PageMeasure } from '$lib/ui/page';

export interface ScreenBack {
	href: string;
	label: string;
	onclick?: (e: MouseEvent) => void;
	/** `false` hides it where the sidebar already leads there. */
	desktop?: boolean;
}

const KEY = Symbol('screen');

export interface ScreenContext {
	readonly measure: PageMeasure;
}

export function setScreenContext(ctx: ScreenContext) {
	setContext(KEY, ctx);
}

/** Undefined outside a Screen, such as an embedded list. */
export function getScreenContext(): ScreenContext | undefined {
	return getContext<ScreenContext | undefined>(KEY);
}
