<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/ui/button';
	import { Input } from '$lib/ui/input';
	import { SwitchRow } from '$lib/ui/switch';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
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

<section aria-labelledby="external-files" class="flex flex-col gap-3">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h2 id="external-files" class="text-sm font-medium text-muted-foreground">
			{heading}
		</h2>
		{#if !form}<Button variant="outline" disabled={!!busy || loading} onclick={() => edit()}
				>Add file store</Button
			>{/if}
	</div>
	<p class="text-sm text-muted-foreground">
		Connect folders on your file server for the assistant to use.
	</p>
	{#if loading}
		<p role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
			<LoaderCircle
				class="size-4 animate-spin motion-reduce:animate-none"
				aria-hidden="true"
			/>Loading file stores…
		</p>
	{:else if stores.length === 0 && !form && !error}
		<p class="py-2 text-sm text-muted-foreground">
			No file stores connected. Add a folder to make it available to the assistant.
		</p>
	{/if}
	{#if message}<p role="status" class="text-sm">{message}</p>{/if}
	{#if error}
		<p role="alert" class="text-sm text-failed">{error}</p>
		{#if !form}<Button variant="outline" disabled={!!busy} onclick={() => void load()}
				>Reload file stores</Button
			>{/if}
	{/if}
	{#if form}
		<form
			class="flex flex-col gap-3"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<h3 class="font-medium">{form.id ? 'Edit file store' : 'Add file store'}</h3>
			<label class="flex flex-col gap-1.5 text-sm font-medium" for="store-name"
				>Name<Input
					disabled={!!busy}
					id="store-name"
					aria-invalid={!!fieldErrors.name}
					aria-errormessage={fieldErrors.name ? 'store-name-error' : undefined}
					class="min-h-12"
					required
					maxlength={100}
					bind:value={form.name}
					placeholder="Property documents"
				/></label
			>
			{@render issue('name')}
			<label class="flex flex-col gap-1.5 text-sm font-medium" for="store-address"
				>Server address<Input
					disabled={!!busy}
					id="store-address"
					aria-invalid={!!fieldErrors.endpoint}
					aria-errormessage={fieldErrors.endpoint ? 'store-endpoint-error' : undefined}
					class="min-h-12"
					type="url"
					required
					bind:value={form.endpoint}
					placeholder="https://fileserver:5006"
					aria-describedby="store-address-help"
				/></label
			>
			{@render issue('endpoint')}
			<p id="store-address-help" class="text-sm text-muted-foreground">
				Use the server’s Tailscale address and HTTPS port.
			</p>
			<fieldset class="flex min-w-0 flex-col gap-2">
				<legend class="mb-2 text-sm font-medium">Allowed folders</legend>
				<p id="store-folder-help" class="text-sm text-muted-foreground">
					Writes are off by default. Restrict the NAS account to these folders too.
				</p>
				{@render issue('folders')}
				<div class="flex flex-col divide-y">
					{#each form.folders as folder, index}
						<div class="flex min-w-0 flex-col gap-2 py-3">
							<label for={`store-folder-${index}`} class="flex flex-col gap-1.5 text-sm font-medium"
								>Folder {index + 1}<Input
									disabled={!!busy}
									id={`store-folder-${index}`}
									class="min-h-12"
									required
									bind:value={folder.path}
									placeholder="/public/Property"
									aria-describedby="store-folder-help"
									aria-invalid={!!fieldErrors.folders}
									aria-errormessage={fieldErrors.folders ? 'store-folders-error' : undefined}
								/></label
							>
							<SwitchRow
								checked={folder.writable}
								disabled={!!busy}
								onchange={(value) => (folder.writable = value)}
								class="min-h-12 rounded-lg px-0 py-1.5"
								><span class="font-medium">Allow writes for folder {index + 1}</span></SwitchRow
							>
							{#if form.folders.length > 1}<Button
									type="button"
									variant="ghost"
									class="self-start"
									disabled={!!busy}
									onclick={() => {
										if (form) form.folders = form.folders.filter((_, i) => i !== index);
									}}>Remove folder {index + 1}</Button
								>{/if}
						</div>
					{/each}
				</div>
				<Button
					type="button"
					variant="outline"
					class="self-start"
					disabled={!!busy || form.folders.length >= 20}
					onclick={() => {
						if (form) form.folders = [...form.folders, { path: '', writable: false }];
					}}>Add folder</Button
				>
			</fieldset>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1">
					<label class="flex flex-col gap-1.5 text-sm font-medium" for="store-account"
						>NAS account<Input
							disabled={!!busy}
							id="store-account"
							aria-invalid={!!fieldErrors.username}
							aria-errormessage={fieldErrors.username ? 'store-username-error' : undefined}
							class="min-h-12"
							required
							autocomplete="username"
							bind:value={form.username}
						/></label
					>
					{@render issue('username')}
				</div>
				<div class="flex flex-col gap-1">
					<label class="flex flex-col gap-1.5 text-sm font-medium" for="store-password"
						>Password<Input
							disabled={!!busy}
							id="store-password"
							aria-invalid={!!fieldErrors.password}
							aria-errormessage={fieldErrors.password ? 'store-password-error' : undefined}
							class="min-h-12"
							type="password"
							required={!form.id}
							autocomplete="new-password"
							bind:value={form.password}
							aria-describedby="store-password-help"
						/></label
					>
					{@render issue('password')}
				</div>
			</div>
			<p id="store-password-help" class="text-sm text-muted-foreground">
				{form.id ? 'Leave blank to keep the saved password. ' : ''}Saved on the server; never sent
				to the assistant.
			</p>
			<details class="text-sm" open={!!fieldErrors.certificateSha256}>
				<summary class="min-h-12 cursor-pointer py-2.5 font-medium">Private certificate</summary>
				<div class="flex flex-col gap-2 pt-2">
					<label class="font-medium" for="store-certificate">Verified SHA-256 fingerprint</label>
					<Input
						disabled={!!busy}
						id="store-certificate"
						aria-invalid={!!fieldErrors.certificateSha256}
						aria-errormessage={fieldErrors.certificateSha256
							? 'store-certificateSha256-error'
							: undefined}
						class="min-h-12"
						bind:value={form.certificateSha256}
						maxlength={64}
						pattern={'[a-fA-F0-9]{64}'}
						aria-describedby="store-cert-help"
					/>
					{@render issue('certificateSha256')}
					<p id="store-cert-help" class="text-muted-foreground">
						Optional. Use a fingerprint verified through trusted SSH or DSM. Leave blank for normal
						certificate verification.
					</p>
				</div>
			</details>
			<SwitchRow
				checked={form.enabled}
				disabled={!!busy}
				onchange={(v) => {
					if (form) form.enabled = v;
				}}
				class="min-h-12 rounded-lg px-0 py-1.5"
				><span class="font-medium">Available to the assistant</span></SwitchRow
			>
			<div class="flex flex-wrap gap-2">
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
			</div>
		</form>
	{:else}
		<ul class="flex flex-col divide-y" aria-label="File stores" class:hidden={stores.length === 0}>
			{#each stores as store (store.id)}
				<li class="flex flex-col gap-2 py-3">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<h3 class="font-medium [overflow-wrap:anywhere]">{store.name}</h3>
						<span class="text-sm text-muted-foreground"
							>{!store.enabled
								? 'Disabled'
								: `${store.folders.length} ${store.folders.length === 1 ? 'folder' : 'folders'}`}</span
						>
					</div>
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
					<p class="text-sm [overflow-wrap:anywhere] text-muted-foreground">{store.endpoint}</p>
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
						<p class="text-sm">Remove this connection? Files on the server will stay in place.</p>
						<div class="flex flex-wrap gap-2">
							<Button variant="destructive" disabled={!!busy} onclick={() => void remove(store)}
								>Remove connection</Button
							><Button variant="outline" disabled={!!busy} onclick={() => (removeId = null)}
								>Keep connection</Button
							>
						</div>
					{:else}
						<div class="flex flex-wrap gap-2">
							<Button variant="outline" disabled={!!busy} onclick={() => void test(store)}
								>{busy === store.id ? 'Testing…' : 'Test connection'}</Button
							><Button variant="outline" disabled={!!busy} onclick={() => edit(store)}>Edit</Button
							><Button variant="ghost" disabled={!!busy} onclick={() => (removeId = store.id)}
								>Remove</Button
							>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
