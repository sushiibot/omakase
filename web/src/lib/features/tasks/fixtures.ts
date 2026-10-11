import type { TaskRecord } from './types';
const at = '2026-10-11T12:00:00.000Z';
export const taskFixtures: TaskRecord[] = [
	{
		id: 't-login',
		title: 'Fix login redirect',
		brief:
			'Keep people on the page they requested after sign-in. Verify expired sessions and a fresh login.',
		status: 'needs-you',
		agent: 'coder',
		sourceConversationId: 'main',
		workConversationId: 'task-t-login',
		checklist: [
			{ id: 'c-reproduce', title: 'Reproduce the redirect loop', done: true },
			{ id: 'c-fix', title: 'Implement the fix', done: true },
			{ id: 'c-test', title: 'Test expired sessions', done: false }
		],
		runIds: ['01K6B2N8W3J5Q7R9T1V3X5Z7A9'],
		result: 'The redirect fix is ready. Should expired sessions return to login or show an error?',
		createdAt: at,
		updatedAt: at,
		revision: 1
	},
	{
		id: 't-notes',
		title: 'Review the deployment notes',
		brief: 'Check that the runbook matches the current deployment.',
		status: 'in-progress',
		agent: 'researcher',
		sourceConversationId: 'main',
		checklist: [],
		runIds: [],
		createdAt: at,
		updatedAt: at,
		revision: 1
	},
	{
		id: 't-dentist',
		title: 'Book a dentist appointment',
		brief: 'Find a time next week.',
		status: 'todo',
		sourceConversationId: 'main',
		checklist: [],
		runIds: [],
		createdAt: at,
		updatedAt: at,
		revision: 1
	},
	{
		id: 't-trip',
		title: 'Check train options',
		brief: 'Compare travel times for the October trip.',
		status: 'in-progress',
		agent: 'researcher',
		sourceConversationId: 'oct-trip',
		checklist: [],
		runIds: [],
		createdAt: at,
		updatedAt: at,
		revision: 1
	}
];
