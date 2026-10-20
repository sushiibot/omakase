import { redirect } from '@sveltejs/kit';

// The Artifacts library is now part of Saved; documents keep their /artifacts/<id> pages.
export function load() {
	redirect(307, '/saved?kind=docs');
}
