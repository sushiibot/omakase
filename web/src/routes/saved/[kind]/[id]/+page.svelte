<script lang="ts">
	import { page } from '$app/state';
	import { isSavedKind, SavedItemPage, savedIdFromPath } from '$lib/features/saved';
	const kind = $derived(isSavedKind(page.params.kind) ? page.params.kind : 'document');
	const id = $derived(savedIdFromPath(page.params.id ?? ''));
</script>

<svelte:head><title>Saved · sushii</title></svelte:head>
<SavedItemPage {kind} {id} />
