<!-- shadcn-svelte nova: ui/dropdown-menu/dropdown-menu.svelte -->
<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';

	let { open = $bindable(false), ...restProps }: DropdownMenuPrimitive.RootProps = $props();
</script>

<DropdownMenuPrimitive.Root bind:open {...restProps} />
