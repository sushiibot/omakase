import type { TasksApi } from './api';
import type { TaskRecord } from './types';
import { taskFixtures } from './fixtures';
export function createFixtureTasksApi(): TasksApi {
	let tasks = structuredClone(taskFixtures);
	return {
		async list() {
			return { tasks: structuredClone(tasks) };
		},
		async action(raw) {
			const p = raw as {
				action: string;
				id?: string;
				title?: string;
				brief?: string;
				revision?: number;
				patch?: Partial<TaskRecord>;
				conversationId?: string;
			};
			if (p.action === 'list') return { tasks: structuredClone(tasks) };
			let task = tasks.find((t) => t.id === p.id);
			if (p.action === 'create') {
				const at = new Date().toISOString();
				task = {
					id: `t-${crypto.randomUUID()}`,
					title: p.title!,
					brief: p.brief ?? '',
					status: 'todo',
					sourceConversationId: p.conversationId ?? 'main',
					checklist: [],
					runIds: [],
					revision: 1,
					createdAt: at,
					updatedAt: at
				};
				tasks.push(task);
			}
			if (!task) throw new Error('Task not found.');
			if (p.action === 'update') {
				if (p.revision !== task.revision) throw new Error('Task changed.');
				Object.assign(task, p.patch);
				task.revision++;
			}
			if (p.action === 'start') {
				task.workConversationId ??= `task-${task.id}`;
				task.agent = 'Sushii';
				task.status = 'in-progress';
				task.revision++;
			}
			if (p.action === 'stop') {
				task.status = 'todo';
				task.revision++;
			}
			return { tasks: [structuredClone(task)] };
		}
	};
}
