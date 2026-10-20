import { configureMaintenance } from '$lib/features/maintenance';
import { createFixtureMaintenanceApi } from '$lib/features/maintenance/fake';
import { configureChannels } from '$lib/features/channels';
import { createFixtureChannelsApi } from '$lib/features/channels/fake';
import { configureTasks } from '$lib/features/tasks';
import { configureAgents } from '$lib/features/agents';
import { createFixtureAgentsApi } from '$lib/features/agents/fake';
import { createFixtureTasksApi } from '$lib/features/tasks/fake';
// Dev only (`bun dev` with ?fake); +layout.ts imports it behind import.meta.env.DEV.
import { CLIENT_FEATURES, features } from '$lib/core/features.svelte';
import { createHub, hub } from '$lib/core/realtime/hub.svelte';
import { memoryKeyValue, type Draft, type OutboxEntry } from '$lib/core/storage/outbox';
import { configureBriefing } from '$lib/features/briefing';
import { createFixtureBriefingApi } from '$lib/features/briefing/fake';
import { configureBrowser } from '$lib/features/browser';
import { createFixtureBrowserApi } from '$lib/features/browser/fake';
import { configureChat, configureModels, createFixtureModelsApi } from '$lib/features/chat';
import { createFakeBackend } from '$lib/features/chat/fake';
import { configureConnectors } from '$lib/features/connectors';
import { createFixtureConnectorsApi } from '$lib/features/connectors/fake';
import { configureFileStores } from '$lib/features/file-stores';
import { createFixtureFileStoresApi } from '$lib/features/file-stores/fake';
import { configureHistory } from '$lib/features/history';
import { fixtureHistoryApi } from '$lib/features/history/fake';
import { configureHome } from '$lib/features/home';
import { fixtureHomeApi } from '$lib/features/home/fake';
import { configureMemory } from '$lib/features/memory';
import { createFixtureMemoryApi } from '$lib/features/memory/fake';
import { configureRuns } from '$lib/features/runs';
import { fixtureRunsApi } from '$lib/features/runs/fake';
import { configureSaved } from '$lib/features/saved';
import { createFixtureSavedApi } from '$lib/features/saved/fake';
import { configureSchedules } from '$lib/features/schedules';
import { configureSettings } from '$lib/features/settings';
import { createFixtureSettingsApi } from '$lib/features/settings/fake';
import { createFixtureSchedulesApi } from '$lib/features/schedules/fake';
import { configureSkills } from '$lib/features/skills';
import { createFixtureSkillsApi } from '$lib/features/skills/fake';
import { configureThreads } from '$lib/features/threads';
import { createFixtureThreadsApi } from '$lib/features/threads/fake';

export function installFakes() {
	configureMaintenance(createFixtureMaintenanceApi());
	const fake = createFakeBackend();
	const threadsApi = createFixtureThreadsApi();
	const tasksApi = createFixtureTasksApi();
	configureChannels({
		api: createFixtureChannelsApi({ threads: threadsApi, tasks: tasksApi, main: fake.api })
	});
	hub.useTransport(fake.transport);
	configureChat({ api: fake.api });
	configureModels(createFixtureModelsApi());
	configureHome({ api: fixtureHomeApi });
	configureTasks(tasksApi, (task) => {
		const fakeTask = createFakeBackend({
			reply: 'I kept this follow-up with the task and updated its plan.'
		});
		return {
			approvals: true,
			hub: createHub({
				transport: fakeTask.transport,
				carries: `thread:${task.workConversationId}`
			}),
			api: fakeTask.api,
			outbox: memoryKeyValue<OutboxEntry>((e) => e.clientId),
			drafts: memoryKeyValue<Draft>((d) => d.id)
		};
	});
	configureAgents(createFixtureAgentsApi());
	configureRuns(fixtureRunsApi);
	configureSaved(createFixtureSavedApi());
	configureHistory(fixtureHistoryApi);
	configureMemory(createFixtureMemoryApi());
	configureSkills(createFixtureSkillsApi());
	configureSchedules(createFixtureSchedulesApi());
	configureBrowser(createFixtureBrowserApi());
	configureBriefing(createFixtureBriefingApi());
	configureConnectors(createFixtureConnectorsApi());
	configureSettings(createFixtureSettingsApi());
	configureFileStores(createFixtureFileStoresApi());
	// Each thread answers from its own scripted bot, seeded with its history.
	configureThreads({
		api: threadsApi,
		chat: (detail) => {
			const thread = createFakeBackend({
				history: detail.history,
				reply: 'Noted. I kept this in the thread, and saved anything worth remembering.'
			});
			return {
				hub: createHub({ transport: thread.transport, carries: `thread:${detail.summary.id}` }),
				api: thread.api,
				outbox: memoryKeyValue<OutboxEntry>((e) => e.clientId),
				drafts: memoryKeyValue<Draft>((d) => d.id)
			};
		}
	});
	features.fresh = true;
	// For this page view only, so a later visit without ?fake shows what production shows.
	features.override = new Set(CLIENT_FEATURES);
}
