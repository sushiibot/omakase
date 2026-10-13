<!-- shadcn-svelte nova: ui/sheet/sheet-portal.svelte -->
<script lang="ts">
	import { Dialog as SheetPrimitive } from 'bits-ui';

	let { ...restProps }: SheetPrimitive.PortalProps = $props();
</script>

<SheetPrimitive.Portal {...restProps} />
