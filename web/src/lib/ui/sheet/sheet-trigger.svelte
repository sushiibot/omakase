<!-- shadcn-svelte nova: ui/sheet/sheet-trigger.svelte -->
<script lang="ts">
	import { Dialog as SheetPrimitive } from 'bits-ui';

	let { ref = $bindable(null), ...restProps }: SheetPrimitive.TriggerProps = $props();
</script>

<SheetPrimitive.Trigger bind:ref data-slot="sheet-trigger" {...restProps} />
