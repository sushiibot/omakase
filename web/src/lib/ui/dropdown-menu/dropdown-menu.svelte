<!-- shadcn-svelte nova: ui/dropdown-menu/dropdown-menu.svelte -->
<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';

	let { open = $bindable(false), ...restProps }: DropdownMenuPrimitive.RootProps = $props();

	type Watcher = { onclose: (() => void) | null; destroy(): void };
	// bits-ui menus are divs, so without a CloseWatcher Android back leaves the screen instead.
	$effect(() => {
		const CloseWatcher = (globalThis as { CloseWatcher?: new () => Watcher }).CloseWatcher;
		if (!open || !CloseWatcher) return;
		const watcher = new CloseWatcher();
		watcher.onclose = () => (open = false);
		return () => watcher.destroy();
	});
</script>

<DropdownMenuPrimitive.Root bind:open {...restProps} />
