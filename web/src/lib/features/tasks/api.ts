import { request } from '$lib/core/http';
import type { TaskRecord } from './types';
export interface TasksApi {
	list(): Promise<{ tasks: TaskRecord[] }>;
	action(body: unknown): Promise<{ tasks: TaskRecord[] }>;
}
export const tasksApi: TasksApi = {
	list: () => request('GET', '/tasks'),
	action: (body) => request('POST', '/tasks', body)
};
