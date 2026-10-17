<script lang="ts">
	import { features } from '$lib/core/features.svelte';
	import { workspaceFor } from '$lib/core/nav/nav';
	import { pwa } from '$lib/core/pwa/pwa.svelte';
	import { WorkspaceScreen } from '$lib/features/workspace';
</script>

<svelte:head><title>Workspace · sushii</title></svelte:head>
<WorkspaceScreen
	entries={workspaceFor(features.has)}
	online={pwa.online}
	onreload={() => pwa.reload()}
/>
