import { redirect } from '@sveltejs/kit';
import { channelsStore } from '$lib/features/channels';

const INBOX_PARAMS = ['approve', 'ask', 'item'];
const STATUS_WAIT_MS = 1500;

// The app opens on Home, or on the chat while it's working or waiting on you. Links from before the
// inbox moved keep their item.
export async function load({ url, parent }) {
	const key = INBOX_PARAMS.find((k) => url.searchParams.has(k));
	if (key) redirect(307, `/inbox?${key}=${encodeURIComponent(url.searchParams.get(key)!)}`);
	await parent();
	redirect(307, (await mainBusy()) ? '/chat' : '/assistant');
}

async function mainBusy(): Promise<boolean> {
	const list = channelsStore().list;
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		list.ensure(),
		new Promise((resolve) => (timer = setTimeout(resolve, STATUS_WAIT_MS)))
	]);
	clearTimeout(timer);
	const main = list.data?.channels.find((c) => c.kind === 'main');
	return main?.state === 'running' || main?.state === 'needs-you';
}
