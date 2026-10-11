export type { TaskRecord } from '$lib/core/realtime/events';
import type { TaskRecord } from '$lib/core/realtime/events';
export const taskLabels: Record<TaskRecord['status'], string> = {
	todo: 'To do',
	'in-progress': 'In progress',
	'needs-you': 'Needs you',
	done: 'Done',
	cancelled: 'Cancelled'
};
export const taskSections: TaskRecord['status'][] = [
	'needs-you',
	'in-progress',
	'todo',
	'done',
	'cancelled'
];
