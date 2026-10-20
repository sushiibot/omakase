import { redirect } from '@sveltejs/kit';

// Push and inbox links open their item over Home. Closing the review stays on Home instead of
// landing on the Channels list.
export function load({ url }) {
	redirect(307, `/assistant${url.search}`);
}
