import { redirect } from '@sveltejs/kit';

// Preserve the old overflow URL as an entry to workspace information and tools.
export function load() {
	redirect(307, '/workspace');
}
