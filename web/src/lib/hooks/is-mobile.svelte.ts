// shadcn-svelte nova: hooks/is-mobile.svelte.ts
import { MediaQuery } from 'svelte/reactivity';
import { MOBILE_BREAKPOINT } from '$lib/ui/breakpoints';

export class IsMobile extends MediaQuery {
	constructor(breakpoint: number = MOBILE_BREAKPOINT) {
		super(`max-width: ${breakpoint - 1}px`);
	}
}
