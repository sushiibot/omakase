const KEY = 'artifacts:recent:v1';
class ArtifactVisits {
	ids = $state<string[]>([]);
	constructor() {
		try {
			const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
			if (Array.isArray(saved))
				this.ids = [
					...new Set(saved.filter((id): id is string => typeof id === 'string' && id.length <= 80))
				].slice(0, 50);
		} catch {
			/* Storage can be unavailable. */
		}
	}
	visit(id: string) {
		if (this.ids[0] === id) return;
		this.ids = [id, ...this.ids.filter((previous) => previous !== id)].slice(0, 50);
		try {
			localStorage.setItem(KEY, JSON.stringify(this.ids));
		} catch {
			/* Keep session visits. */
		}
	}
}
let shared: ArtifactVisits;
export function artifactVisits() {
	return (shared ??= new ArtifactVisits());
}
