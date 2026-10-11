<script lang="ts">
	import { runsStore, RunRow } from '$lib/features/runs';
	import { Button } from '$lib/ui/button';
	let { ids }: { ids: string[] } = $props();
	const store = runsStore();
	const views = $derived([...ids].reverse().map((id) => ({ id, view: store.run(id) })));
	$effect(() => {
		const current = views;
		const stops = current.map(({ view }) => {
			void view.remote.ensure();
			return view.remote.watch();
		});
		const timer = setInterval(() => {
			if (!document.hidden)
				for (const { view } of current)
					if (view.remote.data?.run.status === 'running') void view.remote.refetch();
		}, 5000);
		return () => {
			clearInterval(timer);
			for (const stop of stops) stop();
		};
	});
</script>

<ul class="divide-y">
	{#each views as { id, view } (id)}
		<li>
			{#if view.remote.data}
				<RunRow run={view.remote.data.run} now={Date.now()} href={`/runs/${id}`} />
				{#if view.remote.data.run.resultSummary}<p
						class="px-2 pb-3 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground"
					>
						{view.remote.data.run.resultSummary}
					</p>{/if}
			{:else if view.remote.error}
				<p role="alert" class="py-2 text-sm text-failed">{view.remote.error}</p>
				<Button variant="outline" onclick={() => void view.remote.refetch()}>Retry activity</Button>
			{:else if view.remote.status === 'ready'}
				<p class="py-3 text-sm text-muted-foreground">
					This run's activity record is no longer available.
				</p>
			{:else}<p role="status" class="py-3 text-sm text-muted-foreground">Loading activity…</p>{/if}
		</li>
	{/each}
</ul>
