<script lang="ts">
	import { page } from '$app/state';
	import { SavedItemPage } from '$lib/features/saved';
	// Chat links documents here; the page is the saved item's, so both URLs show the same thing.
	const id = $derived(page.params.id ?? '');
</script>

<svelte:head><title>Document · sushii</title></svelte:head>
<SavedItemPage kind="document" {id} />
