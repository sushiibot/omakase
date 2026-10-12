import { describe, expect, test } from 'bun:test';
import { render } from 'svelte/server';
import TaskInspector from './task-inspector.svelte';
import TaskDetail from './task-detail.svelte';
import { taskFixtures } from './fixtures';

const props = {
	task: taskFixtures[0],
	busy: false,
	error: null,
	onback: () => {},
	onupdate: async () => true,
	onstart: async () => true,
	onstop: () => {},
	onretry: () => {}
};

describe('task inspector', () => {
	test('keeps supporting details separate from the task conversation', () => {
		const html = render(TaskInspector, {
			props: { ...props, fullHref: '/tasks/t-login', onclose: () => {} }
		}).body;
		expect(html).toContain('data-task-inspector');
		expect(html).toContain('href="/tasks/t-login"');
		expect(html).toContain('Open task conversation');
		expect(html).toContain('Close task details');
		expect(html).toContain('New checklist step');
		expect(html).toContain('Test expired sessions');
		expect(html).toContain('Latest result');
		expect(html).toContain('The redirect fix is ready.');
		expect(html).not.toContain('aria-label="Message"');
		expect(html).not.toContain('Send message');
		expect(html).not.toContain('<textarea');
	});

	test('preserves the standalone task detail conversation entry', () => {
		const html = render(TaskDetail, { props }).body;
		expect(html).toContain('data-task-detail');
		expect(html).toContain('Conversation');
		expect(html).toContain('Overview');
	});

	test('explains an unstarted task without a result or execution history', () => {
		const html = render(TaskInspector, {
			props: { ...props, task: taskFixtures[2], fullHref: '/tasks/t-dentist' }
		}).body;
		expect(html).toContain('No execution activity yet.');
		expect(html).toContain('No result yet.');
		expect(html).toContain('Ask Sushii to work on this');
	});
});
