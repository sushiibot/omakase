<!-- shadcn-svelte nova: ui/spinner/spinner.svelte -->
<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import { cn } from '$lib/utils.js';
	import type { SVGAttributes } from 'svelte/elements';

	let {
		class: className,
		role = 'status',
		decorative = false,
		// we add name, color, and stroke for compatibility with different icon libraries props.
		// only forward them when set, otherwise `stroke: undefined` overrides the icon's `currentColor`
		name,
		color,
		stroke,
		className: legacyClassName,
		'aria-label': ariaLabel = 'Loading',
		...restProps
	}: SVGAttributes<SVGSVGElement> & {
		/** Hidden from assistive tech, for a spinner beside text that already says what is loading. */
		decorative?: boolean;
	} = $props();
</script>

<Loader2Icon
	{...decorative
		? { role: 'presentation', 'aria-hidden': 'true' as const }
		: { role, 'aria-label': ariaLabel }}
	{...name != null ? { name } : {}}
	{...color != null ? { color } : {}}
	{...stroke != null ? { stroke } : {}}
	{...legacyClassName != null ? { className: legacyClassName } : {}}
	class={cn('size-4 animate-spin motion-reduce:animate-none', className)}
	{...restProps}
/>
