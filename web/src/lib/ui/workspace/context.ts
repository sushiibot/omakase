import { getContext, setContext, type Snippet } from 'svelte';

export interface WorkspaceInspector {
	content: Snippet;
	readonly open: boolean;
	onopen(): void;
	onclose(): void;
}

export interface WorkspaceHandle {
	readonly contentVisible: boolean;
	/** The inspector sits beside the conversation rather than sliding over it. */
	readonly docked: boolean;
	registerInspector(inspector: WorkspaceInspector): () => void;
}

const KEY = Symbol('workspace');
export const setWorkspace = (handle: WorkspaceHandle) => setContext(KEY, handle);
export const getWorkspace = () => getContext<WorkspaceHandle | undefined>(KEY);
