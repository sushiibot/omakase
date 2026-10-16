import { hub, type Hub } from '$lib/core/realtime/hub.svelte';
import { Remote } from '$lib/core/remote.svelte';
import { httpChannelsApi, type ChannelsApi } from './api';
import { selectChannels } from './navigation';
import type { Channel, ChannelCatalog, ChannelFilter, ChannelView } from './types';

export const CHANNEL_VISITS_KEY = 'channels:recent:v1';
export const CHANNEL_READS_KEY = 'channels:read:v1';
const MAX_VISITS = 100;
export interface ChannelVisitsStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}
export interface ChannelsDeps {
	api?: ChannelsApi;
	hub?: Hub;
	storage?: ChannelVisitsStorage | null;
}
function deviceStorage(): ChannelVisitsStorage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}
function readVisits(storage: ChannelVisitsStorage | null): string[] {
	try {
		const value: unknown = JSON.parse(storage?.getItem(CHANNEL_VISITS_KEY) ?? '[]');
		return Array.isArray(value)
			? [
					...new Set(
						value.filter(
							(id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 80
						)
					)
				].slice(0, MAX_VISITS)
			: [];
	} catch {
		return [];
	}
}

export class ChannelsStore {
	readonly list: Remote<ChannelCatalog>;
	recentIds = $state.raw<string[]>([]);
	readSequences = $state.raw<Record<string, number>>({});
	#hub: Hub;
	#storage: ChannelVisitsStorage | null;
	#watchers = 0;
	#unsubscribe: (() => void) | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	constructor({
		api = httpChannelsApi,
		hub: realtime = hub,
		storage = deviceStorage()
	}: ChannelsDeps = {}) {
		this.list = new Remote(() => api.list(), { refetchOnFocus: true });
		this.#hub = realtime;
		this.#storage = storage;
		this.recentIds = readVisits(storage);
		try {
			const saved: unknown = JSON.parse(storage?.getItem(CHANNEL_READS_KEY) ?? '{}');
			if (saved && typeof saved === 'object' && !Array.isArray(saved))
				this.readSequences = Object.fromEntries(
					Object.entries(saved).filter(
						([id, seq]) => id.length <= 80 && Number.isSafeInteger(seq) && Number(seq) >= 0
					)
				);
		} catch {
			/* Invalid device state starts with no read receipts. */
		}
	}
	visible(view: ChannelView = 'all', filter: ChannelFilter = {}): Channel[] {
		return selectChannels(this.list.data?.channels ?? [], view, this.recentIds, filter).map(
			(channel) => ({
				...channel,
				hasNewMessages:
					channel.lastMessageSeq !== null &&
					channel.lastMessageSeq > (this.readSequences[channel.id] ?? 0)
			})
		);
	}
	markRead(id: string, sequence: number | null): void {
		if (
			sequence === null ||
			!Number.isSafeInteger(sequence) ||
			sequence < 0 ||
			(this.readSequences[id] ?? -1) >= sequence
		)
			return;
		this.readSequences = { ...this.readSequences, [id]: sequence };
		try {
			this.#storage?.setItem(CHANNEL_READS_KEY, JSON.stringify(this.readSequences));
		} catch {
			/* Session-only when storage is unavailable. */
		}
	}
	visit(id: string): void {
		if (!id || id.length > 80 || this.recentIds[0] === id) return;
		this.recentIds = [id, ...this.recentIds.filter((previous) => previous !== id)].slice(
			0,
			MAX_VISITS
		);
		try {
			this.#storage?.setItem(CHANNEL_VISITS_KEY, JSON.stringify(this.recentIds));
		} catch {
			/* Storage may be disabled; visits still work for this session. */
		}
	}
	#refreshSoon = () => {
		if (this.#timer !== undefined) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			if (this.#watchers) void this.list.refetch();
		}, 150);
	};
	watch(): () => void {
		const stopFocus = this.list.watch();
		if (this.#watchers++ === 0) {
			this.#unsubscribe = this.#hub.subscribe({ types: ['threads', 'reply', 'user'] }, (batch) => {
				if (
					batch.some(
						(event) =>
							event.type === 'threads' ||
							event.type === 'reply' ||
							event.type === 'user' ||
							event.type === 'hello' ||
							event.type === 'reset' ||
							(event.type === 'workspace' && event.data.state === 'online')
					)
				)
					this.#refreshSoon();
			});
			this.#hub.start();
			void this.list.ensure();
		}
		let stopped = false;
		return () => {
			if (stopped) return;
			stopped = true;
			stopFocus();
			if (--this.#watchers !== 0) return;
			this.#unsubscribe?.();
			this.#unsubscribe = undefined;
			if (this.#timer !== undefined) clearTimeout(this.#timer);
			this.#timer = undefined;
		};
	}
}
let store: ChannelsStore | undefined;
let configured: ChannelsDeps = {};
export function configureChannels(deps: ChannelsDeps): void {
	configured = deps;
}
export function channelsStore(): ChannelsStore {
	return (store ??= new ChannelsStore(configured));
}
