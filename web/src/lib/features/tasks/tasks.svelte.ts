import { HttpError } from '$lib/core/http';
import { tasksApi, type TasksApi } from './api';
import type { ChatStoreDeps } from '$lib/features/chat';
import type { TaskRecord } from './types';
export class TasksStore {
	tasks = $state<TaskRecord[]>([]);
	loading = $state(true);
	error = $state<string | null>(null);
	busy = $state(false);
	private pending: Promise<void> | undefined;
	private mutationError = false;
	async refresh(clearError = false) {
		if (clearError) {
			this.mutationError = false;
			this.error = null;
		}
		if (this.pending) return this.pending;
		this.pending = (async () => {
			try {
				const result = await configured.list();
				this.tasks = result.tasks.map((t) => {
					const previous = this.tasks.find((p) => p.id === t.id);
					return previous && previous.revision > t.revision ? previous : t;
				});
				if (!this.mutationError) this.error = null;
			} catch (err) {
				this.error = err instanceof Error ? err.message : 'Could not load tasks.';
			} finally {
				this.loading = false;
				this.pending = undefined;
			}
		})();
		return this.pending;
	}
	async action(body: unknown): Promise<TaskRecord | null> {
		if (this.busy) return null;
		this.busy = true;
		this.mutationError = false;
		this.error = null;
		try {
			const result = await configured.action(body);
			for (const task of result.tasks)
				this.tasks = [...this.tasks.filter((t) => t.id !== task.id), task];
			return result.tasks[0] ?? null;
		} catch (err) {
			this.mutationError = true;
			this.error =
				err instanceof HttpError && err.status === 409
					? 'This task changed or could not accept the action. Reload it and try again. Your draft is kept.'
					: err instanceof Error
						? err.message
						: 'Could not update the task.';
			return null;
		} finally {
			this.busy = false;
		}
	}
	update(
		task: TaskRecord,
		patch: Partial<Pick<TaskRecord, 'title' | 'brief' | 'status' | 'checklist'>>
	) {
		return this.action({ action: 'update', id: task.id, revision: task.revision, patch });
	}
	watch() {
		void this.refresh();
		const timer = setInterval(() => {
			if (!document.hidden && !this.busy) void this.refresh();
		}, 5000);
		return () => clearInterval(timer);
	}
}
let shared: TasksStore;
export function tasksStore() {
	return (shared ??= new TasksStore());
}

let configured: TasksApi = tasksApi;
let configuredChat: ((task: TaskRecord) => ChatStoreDeps) | undefined;
export function configureTasks(api: TasksApi, chat?: (task: TaskRecord) => ChatStoreDeps) {
	configured = api;
	configuredChat = chat;
}
export function taskChatDeps(task: TaskRecord) {
	return configuredChat?.(task);
}
