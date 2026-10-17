import { toolPolicyApi } from './api';
export class ToolPolicyStore {
	rules = $state('');
	loaded = $state(false);
	busy = $state(false);
	error = $state<string | null>(null);
	notice = $state<string | null>(null);
	async load() {
		this.busy = true;
		this.error = null;
		try {
			this.rules = (await toolPolicyApi.read()).rules;
			this.loaded = true;
		} catch (error) {
			this.error =
				error instanceof Error ? error.message : 'Could not load tool permissions. Try again.';
		} finally {
			this.busy = false;
		}
	}
	async save(rules: string) {
		this.busy = true;
		this.error = null;
		this.notice = null;
		try {
			this.rules = (await toolPolicyApi.save(rules)).rules;
			this.notice = 'Rules saved.';
		} catch (error) {
			this.error = error instanceof Error ? error.message : 'Could not save rules. Try again.';
		} finally {
			this.busy = false;
		}
	}
}
