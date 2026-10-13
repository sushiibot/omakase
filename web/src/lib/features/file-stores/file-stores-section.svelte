<script lang="ts">
	import { onMount } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Badge } from '$lib/ui/badge';
	import { Button } from '$lib/ui/button';
	import * as Collapsible from '$lib/ui/collapsible';
	import * as Field from '$lib/ui/field';
	import { Input } from '$lib/ui/input';
	import * as Item from '$lib/ui/item';
	import Section from '$lib/ui/section/section.svelte';
	import { Spinner } from '$lib/ui/spinner';
	import { Switch } from '$lib/ui/switch';
	import { fileStoresApi, FileStoreApiError } from './api';
	import type { FileStore, FileStoreInput } from './types';
	let stores = $state<FileStore[]>([]);
	let loading = $state(true);
	let error = $state('');
	let fieldErrors = $state<Record<string, string[]>>({});
	let form = $state<FileStoreInput | null>(null);
	let busy = $state('');
	let baseline = $state('');
	const dirty = $derived(form !== null && JSON.stringify(form) !== baseline);
	let {
		ondirty,
		heading = 'External file stores'
	}: { ondirty?: (value: boolean) => void; heading?: string } = $props();
	$effect(() => {
		ondirty?.(dirty);
	});
	let results = $state<
		Record<
			string,
			{ ok: boolean; message: string; folders?: { path: string; ok: boolean; message: string }[] }
		>
	>({});
	let removeId = $state<string | null>(null);
	let message = $state('');
	let certificateOpen = $state(false);
	const blank = (): FileStoreInput => ({
		name: '',
		endpoint: '',
		folders: [{ path: '', writable: false }],
		username: '',
		password: '',
		certificateSha256: '',
		enabled: true
	});
	const errorText = (error: unknown) =>
		error instanceof Error ? error.message : 'The request failed. Try again.';
	async function load() {
		loading = true;
		error = '';
		try {
			stores = (await fileStoresApi.list()).stores;
		} catch (e) {
			error = errorText(e);
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void load();
		const guard = (event: BeforeUnloadEvent) => {
			if (dirty) event.preventDefault();
		};
		window.addEventListener('beforeunload', guard);
		return () => window.removeEventListener('beforeunload', guard);
	});
	function edit(store?: FileStore) {
		form = store
			? { ...store, folders: store.folders.map((folder) => ({ ...folder })), password: '' }
			: blank();
		baseline = JSON.stringify(form);
		fieldErrors = {};
		error = '';
		message = '';
		removeId = null;
		certificateOpen = false;
	}
	async function save() {
		if (!form || busy) return;
		busy = 'save';
		error = '';
		fieldErrors = {};
		try {
			const store = (await fileStoresApi.save({ ...form })).store;
			stores = [...stores.filter((s) => s.id !== store.id), store];
			results = Object.fromEntries(Object.entries(results).filter(([id]) => id !== store.id));
			form = null;
			message = 'Connection saved. Test it to check folder access.';
		} catch (e) {
			error = errorText(e);
			if (e instanceof FileStoreApiError) fieldErrors = e.fields;
			if (fieldErrors.certificateSha256) certificateOpen = true;
		} finally {
			busy = '';
		}
	}
	async function test(store: FileStore) {
		busy = store.id;
		error = '';
		message = '';
		try {
			results = { ...results, [store.id]: await fileStoresApi.test(store.id) };
		} catch (e) {
			results = { ...results, [store.id]: { ok: false, message: errorText(e) } };
		} finally {
			busy = '';
		}
	}
	async function remove(store: FileStore) {
		busy = 'remove';
		error = '';
		try {
			await fileStoresApi.remove(store);
			stores = stores.filter((s) => s.id !== store.id);
			removeId = null;
			message = 'Connection removed. Files on the server were not changed.';
		} catch (e) {
			error = errorText(e);
		} finally {
			busy = '';
		}
	}
</script>

{#snippet issue(field: string)}
	{#if fieldErrors[field]}<p id={`store-${field}-error`} class="text-sm text-failed">
			{fieldErrors[field].join(' ')}
		</p>{/if}
{/snippet}

<Section id="external-files" title={heading}>
	{#snippet aside()}
		{#if !form}<Button
				variant="outline"
				class="text-foreground"
				disabled={!!busy || loading}
				onclick={() => edit()}>Add file store</Button
			>{/if}
	{/snippet}
	{#if loading}
		<p role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
			<Spinner role="presentation" aria-hidden="true" class="motion-reduce:animate-none" />Loading
			file stores…
		</p>
	{:else if stores.length === 0 && !form && !error}
		<p class="text-sm text-muted-foreground">
			No file stores connected. Add a folder to make it available to the assistant.
		</p>
	{/if}
	{#if message}<p role="status" class="text-sm">{message}</p>{/if}
	{#if error}
		<p role="alert" class="text-sm text-failed">{error}</p>
		{#if !form}<Button
				class="self-start"
				variant="outline"
				disabled={!!busy}
				onclick={() => void load()}>Reload file stores</Button
			>{/if}
	{/if}
	{#if form}
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<Field.Set>
				<Field.Legend variant="label">{form.id ? 'Edit file store' : 'Add file store'}</Field.Legend
				>
				<Field.Group>
					<Field.Field data-invalid={!!fieldErrors.name || undefined}>
						<Field.Label for="store-name">Name</Field.Label>
						<Input
							disabled={!!busy}
							id="store-name"
							aria-invalid={!!fieldErrors.name}
							aria-errormessage={fieldErrors.name ? 'store-name-error' : undefined}
							required
							maxlength={100}
							bind:value={form.name}
							placeholder="Property documents"
						/>
						{@render issue('name')}
					</Field.Field>
					<Field.Field data-invalid={!!fieldErrors.endpoint || undefined}>
						<Field.Label for="store-address">Server address</Field.Label>
						<Input
							disabled={!!busy}
							id="store-address"
							aria-invalid={!!fieldErrors.endpoint}
							aria-errormessage={fieldErrors.endpoint ? 'store-endpoint-error' : undefined}
							type="url"
							required
							bind:value={form.endpoint}
							placeholder="https://fileserver:5006"
							aria-describedby="store-address-help"
						/>
						{@render issue('endpoint')}
						<Field.Description id="store-address-help">
							Use the server’s Tailscale address and HTTPS port.
						</Field.Description>
					</Field.Field>
					<Field.Set>
						<Field.Legend variant="label">Allowed folders</Field.Legend>
						<Field.Description id="store-folder-help">
							Writes are off by default. Restrict the NAS account to these folders too.
						</Field.Description>
						{@render issue('folders')}
						{#each form.folders as folder, index}
							<Field.Group class="gap-3 border-t pt-4 any-pointer-coarse:gap-4">
								<Field.Field data-invalid={!!fieldErrors.folders || undefined}>
									<Field.Label for={`store-folder-${index}`}>Folder {index + 1}</Field.Label>
									<Input
										disabled={!!busy}
										id={`store-folder-${index}`}
										required
										bind:value={folder.path}
										placeholder="/public/Property"
										aria-describedby="store-folder-help"
										aria-invalid={!!fieldErrors.folders}
										aria-errormessage={fieldErrors.folders ? 'store-folders-error' : undefined}
									/>
								</Field.Field>
								<Field.Field orientation="horizontal">
									<Field.Label for={`store-folder-${index}-writes`}
										>Allow writes for folder {index + 1}</Field.Label
									>
									<Switch
										id={`store-folder-${index}-writes`}
										disabled={!!busy}
										bind:checked={folder.writable}
										class="any-pointer-coarse:after:-inset-y-3.5"
									/>
								</Field.Field>
								{#if form.folders.length > 1}<Button
										type="button"
										variant="ghost"
										class="self-start"
										disabled={!!busy}
										onclick={() => {
											if (form) form.folders = form.folders.filter((_, i) => i !== index);
										}}>Remove folder {index + 1}</Button
									>{/if}
							</Field.Group>
						{/each}
						<Button
							type="button"
							variant="outline"
							class="self-start"
							disabled={!!busy || form.folders.length >= 20}
							onclick={() => {
								if (form) form.folders = [...form.folders, { path: '', writable: false }];
							}}>Add folder</Button
						>
					</Field.Set>
					<div class="grid gap-4 @md/field-group:grid-cols-2">
						<Field.Field data-invalid={!!fieldErrors.username || undefined}>
							<Field.Label for="store-account">NAS account</Field.Label>
							<Input
								disabled={!!busy}
								id="store-account"
								aria-invalid={!!fieldErrors.username}
								aria-errormessage={fieldErrors.username ? 'store-username-error' : undefined}
								required
								autocomplete="username"
								bind:value={form.username}
							/>
							{@render issue('username')}
						</Field.Field>
						<Field.Field data-invalid={!!fieldErrors.password || undefined}>
							<Field.Label for="store-password">Password</Field.Label>
							<Input
								disabled={!!busy}
								id="store-password"
								aria-invalid={!!fieldErrors.password}
								aria-errormessage={fieldErrors.password ? 'store-password-error' : undefined}
								type="password"
								required={!form.id}
								autocomplete="new-password"
								bind:value={form.password}
								aria-describedby="store-password-help"
							/>
							{@render issue('password')}
						</Field.Field>
						<Field.Description id="store-password-help" class="@md/field-group:col-span-2">
							{form.id ? 'Leave blank to keep the saved password. ' : ''}Saved on the server; never
							sent to the assistant.
						</Field.Description>
					</div>
					<Collapsible.Root bind:open={certificateOpen} class="flex flex-col gap-3">
						<Collapsible.Trigger>
							{#snippet child({ props })}
								<Button {...props} variant="ghost" class="group/cert -ms-2.5 self-start"
									>Private certificate<ChevronDown
										class="transition-transform group-data-[state=open]/cert:rotate-180 motion-reduce:transition-none"
										aria-hidden="true"
									/></Button
								>
							{/snippet}
						</Collapsible.Trigger>
						<Collapsible.Content>
							<Field.Field data-invalid={!!fieldErrors.certificateSha256 || undefined}>
								<Field.Label for="store-certificate">Verified SHA-256 fingerprint</Field.Label>
								<Input
									disabled={!!busy}
									id="store-certificate"
									aria-invalid={!!fieldErrors.certificateSha256}
									aria-errormessage={fieldErrors.certificateSha256
										? 'store-certificateSha256-error'
										: undefined}
									bind:value={form.certificateSha256}
									maxlength={64}
									pattern={'[a-fA-F0-9]{64}'}
									aria-describedby="store-cert-help"
								/>
								{@render issue('certificateSha256')}
								<Field.Description id="store-cert-help">
									Optional. Use a fingerprint verified through trusted SSH or DSM. Leave blank for
									normal certificate verification.
								</Field.Description>
							</Field.Field>
						</Collapsible.Content>
					</Collapsible.Root>
					<Field.Field orientation="horizontal">
						<Field.Label for="store-enabled">Available to the assistant</Field.Label>
						<Switch
							id="store-enabled"
							disabled={!!busy}
							bind:checked={form.enabled}
							class="any-pointer-coarse:after:-inset-y-3.5"
						/>
					</Field.Field>
					<Field.Field orientation="horizontal" class="flex-wrap">
						<Button type="submit" disabled={!!busy}
							>{busy === 'save' ? 'Saving…' : 'Save connection'}</Button
						>
						<Button
							type="button"
							variant="outline"
							disabled={!!busy}
							onclick={() => {
								if (!dirty || window.confirm('Discard unsaved file-store changes?')) {
									form = null;
									error = '';
								}
							}}>Cancel</Button
						>
					</Field.Field>
				</Field.Group>
			</Field.Set>
		</form>
	{:else if stores.length}
		<Item.Group aria-label="File stores">
			{#each stores as store (store.id)}
				<div role="listitem">
					<Item.Root variant="outline" size="sm">
						<Item.Content class="min-w-0">
							<Item.Title class="line-clamp-none">
								<h3 class="[overflow-wrap:anywhere]">{store.name}</h3>
							</Item.Title>
							<Item.Description class="[overflow-wrap:anywhere]">{store.endpoint}</Item.Description>
						</Item.Content>
						<Item.Actions>
							<Badge variant={store.enabled ? 'secondary' : 'outline'}
								>{!store.enabled
									? 'Disabled'
									: `${store.folders.length} ${store.folders.length === 1 ? 'folder' : 'folders'}`}</Badge
							>
						</Item.Actions>
						<Item.Footer class="flex-col items-stretch gap-3">
							<ul class="flex flex-col gap-2" aria-label="Allowed folders">
								{#each store.folders as folder}<li
										class="flex flex-wrap items-baseline justify-between gap-2 text-sm"
									>
										<span class="min-w-0 [overflow-wrap:anywhere]">{folder.path}</span><span
											class="text-muted-foreground"
											>{folder.writable ? 'Read and write' : 'Read only'}</span
										>
									</li>{/each}
							</ul>
							{#if results[store.id]}<p
									role={results[store.id].ok ? 'status' : 'alert'}
									class="text-sm"
									class:text-failed={!results[store.id].ok}
								>
									{results[store.id].message}
								</p>{/if}
							{#if results[store.id]?.folders}
								<ul class="flex flex-col gap-2 text-sm" aria-label="Folder connection results">
									{#each results[store.id].folders ?? [] as result}<li
											class:text-failed={!result.ok}
											class="[overflow-wrap:anywhere]"
										>
											{result.path}: {result.message}
										</li>{/each}
								</ul>
							{/if}
							{#if removeId === store.id}
								<p class="text-sm">
									Remove this connection? Files on the server will stay in place.
								</p>
								<div class="flex flex-wrap gap-2 any-pointer-coarse:gap-4">
									<Button variant="destructive" disabled={!!busy} onclick={() => void remove(store)}
										>Remove connection</Button
									><Button variant="outline" disabled={!!busy} onclick={() => (removeId = null)}
										>Keep connection</Button
									>
								</div>
							{:else}
								<div class="flex flex-wrap gap-2 any-pointer-coarse:gap-4">
									<Button variant="outline" disabled={!!busy} onclick={() => void test(store)}
										>{busy === store.id ? 'Testing…' : 'Test connection'}</Button
									><Button variant="outline" disabled={!!busy} onclick={() => edit(store)}
										>Edit</Button
									><Button variant="ghost" disabled={!!busy} onclick={() => (removeId = store.id)}
										>Remove</Button
									>
								</div>
							{/if}
						</Item.Footer>
					</Item.Root>
				</div>
			{/each}
		</Item.Group>
	{/if}
</Section>
