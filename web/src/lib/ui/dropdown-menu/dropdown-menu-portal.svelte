<!-- shadcn-svelte nova: ui/dropdown-menu/dropdown-menu-portal.svelte -->
<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';

	let { ...restProps }: DropdownMenuPrimitive.PortalProps = $props();
</script>

<DropdownMenuPrimitive.Portal {...restProps} />
