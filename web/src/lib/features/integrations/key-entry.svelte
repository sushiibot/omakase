<script lang="ts">
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';
	import { Checkbox } from '$lib/ui/checkbox';
	import Section from '$lib/ui/section/section.svelte';
	import type { Integration } from './types';
	let {
		integration,
		busy,
		online,
		onsave,
		onremove
	}: {
		integration: Integration;
		busy: boolean;
		online: boolean;
		onsave: (id: string, key: string, revision?: string) => Promise<void>;
		onremove: (id: string) => Promise<void>;
	} = $props();
	const uid = $props.id();
	let key = $state('');
	let removing = $state(false);
	let approved = $state(false);
	$effect(() => {
		// A refreshed definition requires fresh review, including across tabs.
		integration.revision;
		key = '';
		approved = false;
		removing = false;
	});
	async function save(id: string) {
		const value = key;
		key = '';
		await onsave(id, value, integration.revision);
		approved = false;
	}
</script>

<Section id={`${uid}-${integration.id}`} title={integration.name}>
	<div class="flex flex-col gap-4">
		<div class="flex flex-col gap-1">
			<p class="text-sm">{integration.capability}</p>
			<p class="text-meta text-muted-foreground">
				{integration.source === 'environment'
					? 'Key configured in server environment'
					: integration.configured
						? 'Key saved on server'
						: 'Setup needed'}
			</p>
		</div>
		<ol class="list-decimal space-y-3 pl-5 text-sm">
			{#each integration.steps as step (step)}<li>{step}</li>{/each}
		</ol>
		<div class="flex flex-wrap gap-2">
			{#each integration.links as link (link.url)}
				<Button variant="outline" href={link.url} target="_blank" rel="noopener noreferrer"
					>{link.label}</Button
				>
			{/each}
		</div>

		{#if integration.operations}
			<div class="flex flex-col gap-2 text-sm">
				<p>
					<span class="font-medium">API destination:</span>
					<span class="break-all">{integration.origin}</span>
				</p>
				<p>
					Authentication: {integration.auth?.type === 'bearer'
						? 'Bearer token'
						: `Header: ${integration.auth?.name}`}
				</p>
				<ul class="space-y-3">
					{#each integration.operations as operation (operation.id)}
						<li class="flex flex-col gap-1">
							<p class="font-medium">{operation.description}</p>
							<p class="font-mono text-meta break-all">{operation.method} {operation.path}</p>
							<p class="text-meta text-muted-foreground">
								Query fields: {operation.query.join(', ') || 'none'}. {operation.body
									? 'Accepts any JSON body.'
									: 'No request body.'}
							</p>
						</li>
					{/each}
				</ul>
				<p class="text-meta text-muted-foreground">
					Up to 30 requests per minute and 1,000 per day. Provider charges can apply. Saving does
					not test the key.
				</p>
			</div>
		{/if}
		<form
			class="flex flex-col gap-3"
			onsubmit={(event) => {
				event.preventDefault();
				if (online && !busy && key.trim() && (!integration.operations || approved))
					void save(integration.id);
			}}
		>
			<label for={`${uid}-key`} class="text-sm font-medium"
				>{integration.configured ? 'Replacement API key' : 'API key'}</label
			>
			<Input
				id={`${uid}-key`}
				type="password"
				bind:value={key}
				autocomplete="off"
				autocapitalize="off"
				spellcheck={false}
				maxlength={integration.operations ? 4096 : 256}
				disabled={busy || !online}
				aria-describedby={`${uid}-help`}
			/>
			<p id={`${uid}-help`} class="text-meta text-muted-foreground">
				Encrypted on your server. The agent can check setup status but cannot read this key. The
				field clears when you submit or leave this page.
			</p>
			{#if integration.operations}
				<label class="flex items-start gap-3 text-sm">
					<Checkbox bind:checked={approved} disabled={busy || !online} />
					<span
						>I trust this destination and allow ongoing access to these operations. JSON bodies may
						select additional actions, resources, or recipients.</span
					>
				</label>
			{/if}
			<div class="flex flex-wrap gap-2">
				<Button
					type="submit"
					disabled={busy || !online || !key.trim() || (!!integration.operations && !approved)}
					>{busy
						? 'Working…'
						: integration.operations
							? 'Approve access and save'
							: 'Save and test'}</Button
				>
				{#if (integration.configured || integration.operations) && integration.source !== 'environment'}<Button
						variant="ghost"
						disabled={busy || !online}
						onclick={() => (removing = !removing)}
						>{integration.operations ? 'Remove integration' : 'Remove key'}</Button
					>{/if}
			</div>
		</form>
		{#if removing}
			<div class="flex flex-col gap-2">
				<p class="text-sm">
					Remove {integration.name}? Saved credentials and approved access will be removed.
				</p>
				<div class="flex gap-2">
					<Button variant="outline" disabled={busy} onclick={() => (removing = false)}
						>Keep key</Button
					>
					<Button
						variant="outline"
						disabled={busy || !online}
						onclick={async () => {
							await onremove(integration.id);
							removing = false;
						}}>Confirm removal</Button
					>
				</div>
			</div>
		{/if}
	</div>
</Section>
