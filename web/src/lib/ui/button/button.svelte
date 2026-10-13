<script lang="ts" module>
	import type { VariantProps } from 'tailwind-variants';
	import { cn, tv, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	// The semantic element owns focus and hit testing; its face owns visual treatment.
	// Keep hover on the outer group so the whole touch target responds consistently.
	const buttonBase =
		"group/button inline-flex shrink-0 items-center justify-center rounded-sm whitespace-nowrap text-sm font-medium outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:ring-2 aria-invalid:ring-destructive/20 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";
	const regularTarget = 'h-12 min-w-12 p-0 desktop-pointer:h-8 desktop-pointer:min-w-8';
	const iconTarget = 'size-12 p-0 desktop-pointer:size-8';

	const targetVariants = tv({
		base: buttonBase,
		variants: {
			size: {
				default: regularTarget,
				// Compatibility aliases: ordinary actions now share one density.
				compact: regularTarget,
				action: regularTarget,
				xs: regularTarget,
				sm: regularTarget,
				lg: 'h-12 min-w-12 p-0 text-body font-semibold',
				icon: iconTarget,
				'icon-xs': iconTarget,
				'icon-sm': iconTarget,
				// Align the target with full-height fields and prominent controls.
				'icon-lg': 'size-12 p-0'
			}
		},
		defaultVariants: { size: 'default' }
	});

	const faceVariants = tv({
		base: 'pointer-events-none inline-flex w-full items-center justify-[inherit] gap-2 rounded-[inherit] border border-transparent bg-clip-padding transition-colors duration-(--duration-short) motion-reduce:transition-none',
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground group-hover/button:bg-primary/80',
				outline:
					'border-border bg-background group-hover/button:bg-muted group-hover/button:text-foreground dark:bg-input/30 dark:border-input dark:group-hover/button:bg-input/50 group-aria-expanded/button:bg-muted group-aria-expanded/button:text-foreground',
				secondary:
					'bg-secondary text-secondary-foreground group-hover/button:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] group-aria-expanded/button:bg-secondary group-aria-expanded/button:text-secondary-foreground',
				ghost:
					'group-hover/button:bg-muted group-hover/button:text-foreground dark:group-hover/button:bg-muted/50 group-aria-expanded/button:bg-muted group-aria-expanded/button:text-foreground',
				destructive:
					'bg-destructive/10 text-destructive group-hover/button:bg-destructive/20 dark:bg-destructive/20 dark:group-hover/button:bg-destructive/30',
				link: 'text-primary underline-offset-4 group-hover/button:underline'
			},
			size: {
				default: 'h-9 min-w-12 px-3 desktop-pointer:h-8 desktop-pointer:min-w-8',
				lg: 'h-full px-6',
				icon: 'size-9 justify-center p-0 desktop-pointer:size-8'
			}
		},
		defaultVariants: { variant: 'default', size: 'default' }
	});

	export type ButtonVariant = VariantProps<typeof faceVariants>['variant'];
	export type ButtonSize = VariantProps<typeof targetVariants>['size'];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href = undefined,
		type = 'button',
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();

	const controlClass = $derived(cn(targetVariants({ size }), className));
	const faceSize = $derived(size === 'lg' ? 'lg' : size?.startsWith('icon') ? 'icon' : 'default');
</script>

{#snippet content()}
	<span data-slot="button-face" class={faceVariants({ variant, size: faceSize })}>
		{@render children?.()}
	</span>
{/snippet}

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={controlClass}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? 'link' : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render content()}
	</a>
{:else}
	<button bind:this={ref} data-slot="button" class={controlClass} {type} {disabled} {...restProps}>
		{@render content()}
	</button>
{/if}
