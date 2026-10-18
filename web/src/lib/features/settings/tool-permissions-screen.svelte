<script lang="ts">
	import { Button } from '$lib/ui/button';
	import { Textarea } from '$lib/ui/textarea';
	import * as Field from '$lib/ui/field';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import ScreenContent from '$lib/ui/screen/screen-content.svelte';
	import ConnectionBanner from '$lib/ui/connection-banner.svelte';
	let {
		rules,
		loaded,
		busy,
		error,
		notice,
		online,
		back,
		onretry,
		onsave
	}: {
		rules: string;
		loaded: boolean;
		busy: boolean;
		error: string | null;
		notice: string | null;
		online: boolean;
		back: { href: string; label: string; desktop?: boolean; onclick?: (e: MouseEvent) => void };
		onretry: () => void;
		onsave: (rules: string) => void;
	} = $props();
	let edited = $state<string | undefined>();
	const disabled = $derived(busy || !online || !loaded);
	const uid = $props.id();
</script>

{#snippet banner()}{#if !online}<ConnectionBanner state={{ kind: 'app-offline' }} />{/if}{/snippet}
<DetailScreen title="Tool permissions" {back} {banner}>
	<ScreenContent>
		<p class="text-sm text-muted-foreground">
			Set rules for how the agent uses connected tools. Sending messages, sharing, and inviting
			other people require your approval.
		</p>
		{#if error}<div role="alert" class="flex flex-wrap items-center gap-3">
				<p class="text-sm text-failed">{error}</p>
				{#if !loaded}<Button variant="outline" disabled={busy || !online} onclick={onretry}
						>Retry</Button
					>{/if}
			</div>{/if}
		{#if notice}<p role="status" class="text-sm">{notice}</p>{/if}
		{#if !loaded && busy}<p role="status" class="text-sm text-muted-foreground">
				Loading permissions…
			</p>{/if}
		{#if loaded}
			<form
				class="flex flex-col gap-6"
				onsubmit={(event) => {
					event.preventDefault();
					onsave(edited ?? rules);
				}}
			>
				<Field.Field>
					<Field.Label for={`${uid}-rules`}>Additional restrictions</Field.Label>
					<Field.Description id={`${uid}-help`}
						>Apply these rules to MCP calls and mail drafts.</Field.Description
					>
					<Textarea
						id={`${uid}-rules`}
						aria-describedby={`${uid}-help`}
						value={edited ?? rules}
						oninput={(e) => (edited = e.currentTarget.value)}
						rows={6}
						maxlength={4000}
						{disabled}
						placeholder="Only read property accounts and prepare drafts. Do not change calendar events."
					/>
				</Field.Field>
				<div class="flex flex-wrap gap-2">
					<Button
						variant="outline"
						{disabled}
						onclick={() =>
							(edited =
								'Use connected services read-only. Do not create, update, delete, send, or notify.')}
						>Use read-only rules</Button
					>
					<Button
						variant="outline"
						{disabled}
						onclick={() =>
							(edited =
								'Read connected services and save private drafts only. Do not send, publish, share, invite, or notify other people.')}
						>Allow drafts only</Button
					>
				</div>
				<p class="text-sm text-muted-foreground">
					The reviewer applies these rules before a call runs. For strict limits on MCP access, also
					restrict permissions at the connected service.
				</p>
				<div><Button type="submit" {disabled}>{busy ? 'Saving…' : 'Save rules'}</Button></div>
			</form>
		{/if}
	</ScreenContent>
</DetailScreen>
