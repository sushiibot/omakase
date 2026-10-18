import { expect, spyOn, test } from 'bun:test';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Dictation } from './dictation.svelte';

// The normal unit loader uses SSR. Compile the actual lifecycle with the client runtime
// to exercise reactive navigation and cleanup without mounting markup or a browser.
const client = new URL('src/index-client.js', import.meta.resolve('svelte/package.json')).href;
const source = await readFile(join(import.meta.dir, 'conversation-lifecycle.svelte.ts'), 'utf8');
const harness = `
export function mount(initial) {
 let current = $state.raw(initial);
 let store = $state(initial.store);
 let sheet = $state();
 let expanded = $state(false);
 const dispose = $effect.root(() => {
  conversationMedia({ conversationId: () => current.id, store: () => store,
   browser: () => current.browser, expanded: () => expanded });
  conversationContext({ store: () => store, models: () => current.models, sheet: () => sheet });
 });
 return { dispose, navigate: (next) => { current = next; store = next.store; },
  running: (value) => store.running = value, open: (value) => sheet = value,
  expand: (value) => expanded = value };
}
`;
const js = compileModule(
	ts.transpileModule(source + harness, {
		compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
	}).outputText,
	{
		filename: 'conversation-lifecycle.svelte.ts',
		generate: 'client'
	}
).js.code;
const resolved = js
	.replaceAll(
		"'svelte/internal/client'",
		JSON.stringify(import.meta.resolve('svelte/internal/client'))
	)
	.replaceAll(/['"]svelte['"]/g, JSON.stringify(client))
	.replaceAll(
		/['"]\.\/dictation\.svelte['"]/g,
		JSON.stringify(import.meta.resolve('./dictation.svelte.ts'))
	);
const { mount } = await import(
	`data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`
);
const { flushSync } = await import(client);

function conversation(id: string) {
	const calls = {
		start: 0,
		stop: 0,
		expanded: [] as boolean[],
		ensure: 0,
		watch: 0,
		unwatch: 0,
		refresh: 0
	};
	return {
		id,
		calls,
		store: { running: false, usage: undefined, items: [] },
		browser: {
			start() {
				calls.start++;
				return () => calls.stop++;
			},
			setExpanded(value: boolean) {
				calls.expanded.push(value);
			}
		},
		models: {
			remote: {
				ensure() {
					calls.ensure++;
				},
				watch() {
					calls.watch++;
					return () => calls.unwatch++;
				}
			},
			refresh() {
				calls.refresh++;
			}
		}
	};
}

test('topic navigation transfers browser, dictation, model watch and polling ownership', () => {
	const callbacks = new Map<number, () => void>();
	let nextTimer = 0;
	const interval = spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void) => {
		const id = ++nextTimer;
		callbacks.set(id, callback);
		return id;
	}) as typeof setInterval);
	const clear = spyOn(globalThis, 'clearInterval').mockImplementation(((id: number) => {
		callbacks.delete(id);
	}) as typeof clearInterval);
	const cancel = spyOn(Dictation.prototype, 'cancel').mockImplementation(() => {});
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const document = { hidden: false };
	Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
	let route: ReturnType<typeof mount>;
	try {
		const first = conversation('first');
		const second = conversation('second');
		route = mount(first);
		flushSync();
		expect(first.calls.start).toBe(1);
		expect(first.calls.watch).toBe(1);
		expect(callbacks.size).toBe(1);
		let initialRefresh = first.calls.refresh;
		for (const tick of callbacks.values()) tick();
		expect(first.calls.refresh).toBe(initialRefresh);
		route.running(true);
		flushSync();
		expect(first.calls.refresh).toBe(initialRefresh + 1);
		expect(first.calls.watch).toBe(1);
		for (const tick of callbacks.values()) tick();
		expect(first.calls.refresh).toBe(initialRefresh + 2);
		route.running(false);
		flushSync();
		initialRefresh = first.calls.refresh;
		route.open('context');
		route.expand(true);
		flushSync();
		expect(first.calls.refresh).toBe(initialRefresh + 1);
		expect(first.calls.expanded).toEqual([false, true]);
		for (const tick of callbacks.values()) tick();
		expect(first.calls.refresh).toBe(initialRefresh + 2);
		document.hidden = true;
		for (const tick of callbacks.values()) tick();
		expect(first.calls.refresh).toBe(initialRefresh + 2);
		document.hidden = false;
		route.navigate(second);
		flushSync();
		expect(first.calls.stop).toBe(1);
		expect(first.calls.unwatch).toBe(1);
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(second.calls.start).toBe(1);
		expect(second.calls.watch).toBe(1);
		expect(second.calls.expanded).toEqual([true]);
		expect(callbacks.size).toBe(1);
		const secondRefresh = second.calls.refresh;
		for (const tick of callbacks.values()) tick();
		expect(second.calls.refresh).toBe(secondRefresh + 1);
		expect(first.calls.refresh).toBe(initialRefresh + 2);
		route.dispose();
		expect(second.calls.stop).toBe(1);
		expect(second.calls.unwatch).toBe(1);
		expect(cancel).toHaveBeenCalledTimes(2);
		expect(callbacks.size).toBe(0);
	} finally {
		route?.dispose();
		interval.mockRestore();
		clear.mockRestore();
		cancel.mockRestore();
		if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
		else Reflect.deleteProperty(globalThis, 'document');
	}
});
