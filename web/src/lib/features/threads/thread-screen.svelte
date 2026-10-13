<script lang="ts">
	import { Spinner } from '$lib/ui/spinner';
	import type { ComponentProps } from 'svelte';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ThreadSettingsSheet from './components/thread-settings-sheet.svelte';
	import Archive from '@lucide/svelte/icons/archive';
	import BookMarked from '@lucide/svelte/icons/book-marked';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { ChatScreen } from '$lib/features/chat';
	import { Button } from '$lib/ui/button';
	import DetailScreen from '$lib/ui/screen/detail-screen.svelte';
	import type { RemoteLike } from '$lib/ui/screen/screen-state.svelte';
	import * as Item from '$lib/ui/item';
	import * as Sheet from '$lib/ui/sheet';
	import RoutedSheet from '$lib/ui/sheet/routed-sheet.svelte';
	import { Skeleton } from '$lib/ui/skeleton';
	import type { MemoryWrite, ThreadDetail, ThreadSheet } from './types';

	type ChatProps = ComponentProps<typeof ChatScreen>;

	let {
		remote,
		detail,
		chat,
		back,
		sheet,
		busy = false,
		error = null,
		sendable = true,
		writeHref = (id) => `/memory/writes/${id}`,
		memoryHref = '/memory/writes',
		onopensheet,
		onclosesheet,
		onclose,
		onrename,
		onretry
	}: {
		remote: RemoteLike;
		/** null: no such thread. */
		detail?: ThreadDetail | null;
		/** The chat screen's props for this thread's conversation. */
		chat?: Omit<
			ChatProps,
			'title' | 'placeholder' | 'subtitle' | 'commandActions' | 'readOnly' | 'back'
		>;
		now: number;
		back: { href: string; label: string; onclick?: (e: MouseEvent) => void };
		sheet?: ThreadSheet | ChatProps['sheet'];
		busy?: boolean;
		error?: string | null;
		/** Messages can be sent here; false until the agent runs threads. */
		sendable?: boolean;
		writeHref?: (id: string) => string;
		memoryHref?: string;
		onopensheet?: (sheet: ThreadSheet) => void;
		onclosesheet?: () => void;
		onclose?: () => void;
		onrename?: (title: string) => void;
		onreopen?: () => void;
		onretry?: () => void;
	} = $props();

	const thread = $derived(detail?.summary);
	const archived = $derived(thread?.state === 'archived');
	const threadSheet = $derived(
		sheet === 'thread-memory' || sheet === 'thread-close' ? sheet : undefined
	);
	const CHAT_SHEETS: readonly string[] = [
		'commands',
		'new',
		'viewer',
		'model',
		'context-boundary',
		'context'
	];
	const chatSheet = $derived(
		sheet && CHAT_SHEETS.includes(sheet) ? (sheet as ChatProps['sheet']) : undefined
	);
	// A closing sheet keeps its content until it has slid away.
	// svelte-ignore state_referenced_locally
	let shown = $state<ThreadSheet | undefined>(threadSheet);
	$effect.pre(() => {
		if (threadSheet) shown = threadSheet;
	});
</script>

{#snippet writeList(items: MemoryWrite[])}
	<Item.Group variant="bordered">
		{#each items as w (w.id)}
			<div role="listitem">
				<Item.Root size="sm">
					{#snippet child({ props })}
						<a href={writeHref(w.id)} {...props}>
							<Item.Content class="min-w-0">
								<Item.Title class="line-clamp-none font-normal [overflow-wrap:anywhere]"
									>{w.summary}</Item.Title
								>
								<Item.Description class="font-mono text-xs [overflow-wrap:anywhere]"
									>{w.file} · {w.when}</Item.Description
								>
							</Item.Content>
							<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						</a>
					{/snippet}
				</Item.Root>
			</div>
		{/each}
	</Item.Group>
{/snippet}

{#snippet subtitle()}
	{#if thread}
		<Button
			variant="link"
			size="xs"
			aria-haspopup="dialog"
			onclick={() => onopensheet?.('thread-memory')}
			class="-my-3 h-10 max-w-full min-w-0 shrink justify-start p-0 font-normal text-muted-foreground hover:text-foreground hover:no-underline any-pointer-coarse:after:hidden"
		>
			<BookMarked class="size-3.5" aria-hidden="true" />
			<span class="truncate"
				>{thread.memoryTracking === false
					? 'Shares memory with Main'
					: `Shares memory with Main · ${thread.writes} ${thread.writes === 1 ? 'write' : 'writes'}`}</span
			>
		</Button>
	{/if}
{/snippet}

{#snippet commandActions()}
	<div class="flex flex-col border-b pb-2">
		<Button
			variant="ghost"
			class="h-auto w-full justify-start gap-3 px-3 py-2.5 text-left any-pointer-coarse:after:hidden"
			onclick={() => onopensheet?.('thread-settings')}
			><Pencil class="text-muted-foreground" />Rename conversation</Button
		>
		{#if !archived}
			<Button
				variant="ghost"
				class="h-auto w-full justify-start gap-3 px-3 py-2.5 text-left any-pointer-coarse:after:hidden"
				onclick={() => onopensheet?.('thread-close')}
				><Archive class="text-muted-foreground" />Archive conversation</Button
			>
		{/if}
	</div>
{/snippet}

{#snippet readOnly()}
	{#if !archived && !sendable}
		<p class="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
			<Archive class="size-4 shrink-0" aria-hidden="true" />
			Read only for now: the agent can't take messages in conversations yet.
		</p>
	{/if}
{/snippet}

{#snippet skeleton()}
	<div class="flex flex-col gap-4 px-4 py-4" aria-hidden="true">
		<Skeleton class="h-28 w-full rounded-xl" />
		<Skeleton class="h-10 w-3/5 self-end rounded-2xl" />
		<Skeleton class="h-16 w-4/5 rounded-2xl" />
	</div>
	<p role="status" class="sr-only">Loading the conversation…</p>
{/snippet}

{#if thread && chat}
	<ChatScreen
		{...chat}
		sheet={chatSheet}
		title={thread.title}
		placeholder="Message in {thread.title}"
		{subtitle}
		{commandActions}
		readOnly={!sendable ? readOnly : undefined}
		back={{ ...back, desktop: true }}
	/>
{:else}
	<DetailScreen
		title={detail === null ? 'Conversation' : 'Loading conversation'}
		{back}
		state={{
			remote: detail === null ? { status: 'ready' } : remote,
			isEmpty: detail === null,
			empty: {
				title: 'Conversation not found',
				body: 'Return to Conversations to choose another conversation.'
			},
			errorTitle: "Couldn't load this conversation.",
			onretry,
			skeleton
		}}
	>
		<span></span>
	</DetailScreen>
{/if}

<RoutedSheet
	open={!!threadSheet}
	label={shown === 'thread-close' ? 'Archive conversation' : 'Memory shared with Main'}
	onclose={() => onclosesheet?.()}
>
	{#if shown === 'thread-memory' && detail}
		<Sheet.Header>
			<Sheet.Title>Memory shared with Main</Sheet.Title>
			<Sheet.Description>
				This conversation has its own history but reads and writes the same memory as Main.
				{#if thread?.memoryTracking !== false}Its writes are tagged with the conversation, so you
					can check or undo them.{:else}Memory changes stay available after you archive the
					conversation.{/if}
			</Sheet.Description>
		</Sheet.Header>
		<div class={['flex flex-col gap-2 px-4', thread?.memoryTracking === false && 'pb-4']}>
			{#if detail.writes.length}
				<h3 class="text-sm font-medium">
					{detail.writes.length}
					{detail.writes.length === 1 ? 'write' : 'writes'} from this conversation
				</h3>
				{@render writeList(detail.writes)}
			{:else if thread?.memoryTracking !== false}
				<p class="text-sm text-muted-foreground">
					Nothing written to memory from this conversation yet.
				</p>
			{/if}
		</div>
		{#if thread?.memoryTracking !== false}
			<Sheet.Footer>
				<Button variant="outline" href={memoryHref}>All memory changes</Button>
			</Sheet.Footer>
		{/if}
	{:else if shown === 'thread-close' && detail}
		<Sheet.Header>
			<Sheet.Title>Archive conversation</Sheet.Title>
			<Sheet.Description>
				{detail.summary.title} moves into the visible Archived section. Its history stays available; send
				a message whenever you want to continue.
			</Sheet.Description>
		</Sheet.Header>
		{#if error}<p role="alert" class="px-4 text-sm text-failed">
				Couldn't archive it. {error}
			</p>{/if}
		<Sheet.Footer class="any-pointer-coarse:gap-4">
			<Button disabled={busy} onclick={onclose}>
				{#if busy}<Spinner decorative />Archiving…{:else}<Archive />Archive conversation{/if}
			</Button>
			<Button variant="ghost" onclick={() => onclosesheet?.()}>Keep current</Button>
		</Sheet.Footer>
	{/if}
</RoutedSheet>

<ThreadSettingsSheet
	open={sheet === 'thread-settings'}
	initialRename
	{thread}
	{busy}
	{error}
	{onrename}
	onarchive={onclose}
	onclose={onclosesheet}
/>
