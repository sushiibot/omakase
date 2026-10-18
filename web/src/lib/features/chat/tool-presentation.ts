/** Deterministic labels from the call itself; never invent a purpose or a successful result. */
export function toolPresentation(tool: string, input: string, fallback = tool) {
	let args: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(input);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
			args = parsed as Record<string, unknown>;
	} catch {
		/* Older activity records contain a plain-text summary. */
	}
	const name = tool.replaceAll('_', ' ');
	const action =
		typeof args.action === 'string' ? args.action : /^action=([\w-]+)$/.exec(input)?.[1];
	const verbs: Record<string, string> = {
		list: 'List',
		get: 'Read',
		search: 'Search',
		create: 'Create',
		update: 'Update',
		delete: 'Delete',
		remove: 'Remove'
	};
	const command = typeof args.command === 'string' ? args.command : input;
	const target = [args.path, args.query, args.url, args.name].find(
		(value) => typeof value === 'string'
	) as string | undefined;
	if (['bash', 'exec_command', 'run_command', 'shell'].includes(tool)) {
		return {
			title: 'Run command',
			detail: command,
			input: Object.keys(args).length > 1 ? input : command
		};
	}
	if (action) return { title: `${verbs[action] ?? action} ${name}`, detail: target, input };
	const titles: Record<string, string> = {
		read: 'Read file',
		edit: 'Edit file',
		write: 'Write file',
		grep: 'Search file contents',
		find: 'Find files',
		ls: 'List files',
		web_search: 'Search the web',
		fetch_url_content: 'Read web page'
	};
	return {
		title: titles[tool] ?? name,
		detail: target ?? (fallback !== tool ? fallback : undefined),
		input
	};
}
