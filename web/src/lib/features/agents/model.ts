import type { StatusKey } from '$lib/ui/status/status';
import type { AgentRecord, AgentRequest, Decision, RequestDetail, TranscriptItem } from './types';

export const providerName = (p: AgentRecord['provider']) =>
	p === 'codex' ? 'Codex' : 'Claude Code';

/** "Codex · Desktop · Code/omakase/web": who, where and in which folder. */
export const agentMeta = (a: AgentRecord) =>
	[providerName(a.provider), a.machineName, a.folder].filter(Boolean).join(' · ');

export type AgentGroup = 'needs-you' | 'working' | 'finished';

export interface AgentState {
	group: AgentGroup;
	of: StatusKey;
	label: string;
	/** The second line: the request, the current step, the error or the outcome. */
	detail?: string;
	live: boolean;
}

/** Status, group and second line for a list row; failures and stalls wait on the owner too. */
export function agentState(a: AgentRecord): AgentState {
	switch (a.remoteStatus) {
		case 'needs-you':
			return {
				group: 'needs-you',
				of: 'waiting',
				label: 'Needs approval',
				detail: a.requestTitle,
				live: true
			};
		case 'failed':
			return { group: 'needs-you', of: 'failed', label: 'Failed', detail: a.error, live: false };
		case 'interrupted':
			return {
				group: 'needs-you',
				of: 'failed',
				label: 'Interrupted',
				detail: a.error,
				live: false
			};
		case 'completed':
			// A finished session is not evidence that the work is right.
			return {
				group: 'finished',
				of: 'done',
				label: 'Finished',
				detail: 'Unverified',
				live: false
			};
		case 'stopped':
			return { group: 'finished', of: 'aborted', label: 'Stopped', live: false };
		default:
			if (a.stalled)
				return {
					group: 'needs-you',
					of: 'stale',
					label: 'No recent output',
					detail: a.activity,
					live: true
				};
			return {
				group: 'working',
				of: 'running',
				label: a.remoteStatus ? 'Running' : 'Starting',
				detail: a.activity,
				live: true
			};
	}
}

const newest = (a: AgentRecord, b: AgentRecord) => b.updatedAt.localeCompare(a.updatedAt);

/** Needs you (pending requests first), Working, then Finished; newest first within each. */
export function groupAgents(agents: AgentRecord[]): Record<AgentGroup, AgentRecord[]> {
	const out: Record<AgentGroup, AgentRecord[]> = { 'needs-you': [], working: [], finished: [] };
	for (const a of agents) out[agentState(a).group].push(a);
	out['needs-you'].sort(
		(a, b) =>
			Number(b.remoteStatus === 'needs-you') - Number(a.remoteStatus === 'needs-you') ||
			newest(a, b)
	);
	out.working.sort(newest);
	out.finished.sort(newest);
	return out;
}

/** Pending owner decisions, counted by request: failures wait in the list but add nothing here. */
export const pendingRequests = (agents: AgentRecord[]) =>
	agents.reduce(
		(n, a) => n + (a.remoteStatus === 'needs-you' ? Math.max(1, a.requests ?? 1) : 0),
		0
	);

/** "41s", "3m", "2h 5m", "4d". */
export function duration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
	return `${Math.floor(h / 24)}d`;
}

/** "2m 14s" for a work group's running time. */
export function preciseDuration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
	return duration(ms);
}

/** Elapsed while live, frozen at the run's length once it ends. */
export const agentAge = (a: AgentRecord, now: number) =>
	duration((agentState(a).live ? now : Date.parse(a.updatedAt)) - Date.parse(a.createdAt));

export type WorkItem = Exclude<TranscriptItem, { kind: 'prompt' | 'turnEnd' }>;

export interface Turn {
	prompt?: Extract<TranscriptItem, { kind: 'prompt' }>;
	/** Commands, files, tools, approvals and commentary, in order. */
	work: WorkItem[];
	answer?: Extract<TranscriptItem, { kind: 'message' }>;
	end?: Extract<TranscriptItem, { kind: 'turnEnd' }>;
	startedAt?: string;
}

/** One turn per prompt; the answer is the message marked final, else the turn's last message once it ended. */
export function turns(items: TranscriptItem[]): Turn[] {
	const out: Turn[] = [];
	let current: Turn | undefined;
	for (const item of items) {
		if (item.kind === 'prompt' || !current) {
			current = { work: [], startedAt: item.at };
			out.push(current);
			if (item.kind === 'prompt') {
				current.prompt = item;
				continue;
			}
		}
		if (item.kind === 'turnEnd') current.end = item;
		else current.work.push(item);
	}
	for (const turn of out) {
		let index = turn.work.findLastIndex((i) => i.kind === 'message' && i.final);
		if (index < 0 && turn.end) index = turn.work.findLastIndex((i) => i.kind === 'message');
		if (index >= 0) {
			turn.answer = turn.work[index] as Turn['answer'];
			turn.work = turn.work.filter((_, i) => i !== index);
		}
	}
	return out;
}

export interface WorkSummary {
	text: string;
	failed: number;
	pending: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Worked 2m 14s · 9 commands · 3 files · 1 failed", or "Working 41s · …" while the turn runs. */
export function workSummary(turn: Turn, now: number): WorkSummary {
	const commands = turn.work.filter((i) => i.kind === 'command').length;
	const tools = turn.work.filter((i) => i.kind === 'tool').length;
	const files = new Set(
		turn.work.flatMap((i) => (i.kind === 'fileChange' ? i.files.map((f) => f.path) : []))
	).size;
	const failed = turn.work.filter(
		(i) =>
			((i.kind === 'command' || i.kind === 'tool' || i.kind === 'fileChange') && i.failed) ||
			(i.kind === 'command' && !!i.exitCode)
	).length;
	const pending = turn.work.filter((i) => i.kind === 'approval' && i.status === 'pending').length;
	const start = Date.parse(turn.startedAt ?? '');
	const end = turn.end ? Date.parse(turn.end.at) : now;
	const time = Number.isNaN(start) ? '' : ` ${preciseDuration(end - start)}`;
	const parts = [
		`${turn.end ? 'Worked' : 'Working'}${time}`,
		commands ? plural(commands, 'command', 'commands') : '',
		files ? plural(files, 'file', 'files') : '',
		tools ? plural(tools, 'tool call', 'tool calls') : '',
		failed ? `${failed} failed` : ''
	].filter(Boolean);
	return { text: parts.join(' · '), failed, pending };
}

/** A key no two request ids share, whatever their JSON type. */
export const requestKey = (id: string | number) => `${typeof id}:${id}`;

const KIND_LABEL: Record<RequestDetail['kind'], string> = {
	command: 'Run a command',
	writeStdin: 'Write to a running terminal',
	fileChange: 'Change files',
	permissions: 'Grant permissions',
	question: 'Answer a question',
	elicitation: 'Give input to a tool'
};

/** The heading and the exact thing being approved, shown in full. */
export function requestView(r: AgentRequest): { title: string; exact?: string } {
	const d = r.detail;
	if (!d) return { title: 'Approval needed' };
	const title =
		d.host && d.kind === 'command' && !d.command
			? `Allow network access to ${d.host}`
			: d.kind === 'fileChange' && d.files?.length
				? `Change ${d.files.length === 1 ? '1 file' : `${d.files.length} files`}`
				: KIND_LABEL[d.kind];
	const exact = [
		d.host ? `${d.protocol ? `${d.protocol} ` : ''}${d.host}` : '',
		d.command ?? '',
		d.grantRoot ? `Write access: ${d.grantRoot}` : '',
		d.files
			?.map((f) => `${f.change} ${f.path}${f.movePath ? ` → ${f.movePath}` : ''}`)
			.join('\n') ?? '',
		d.diff ?? '',
		d.permissions ?? ''
	]
		.filter(Boolean)
		.join('\n');
	return { title, ...(exact ? { exact } : {}) };
}

/** A short warning when the request reaches past the working folder or the sandbox. */
export function requestRisk(r: AgentRequest): string | undefined {
	const d = r.detail;
	if (!d) return undefined;
	if (d.host) return 'Network access';
	if (d.grantRoot) return 'Write access outside the working folder';
	if (d.files?.some((f) => f.change === 'delete')) return 'Deletes files';
	return undefined;
}

/** Decision buttons. Approve-for-this-turn is a separate switch, and cancel is Stop's job. */
export function choices(decisions: Decision[]) {
	const approves = decisions.includes('accept');
	return decisions
		.filter((d) => d !== 'acceptForSession' && (d !== 'cancel' || decisions.length === 1))
		.map((decision) => ({
			decision,
			primary: decision === 'accept',
			label:
				decision === 'accept'
					? 'Approve'
					: decision === 'cancel'
						? 'Cancel request'
						: approves
							? 'Deny'
							: 'Decline'
		}));
}

export interface Placement {
	/** Live requests to show as cards after each turn's work, by turn index. */
	byTurn: Map<number, AgentRequest[]>;
	/** The pending approval items those cards stand in for; the work group leaves them out. */
	items: Set<WorkItem>;
	/** Live requests no pending item names, shown after the transcript. */
	loose: AgentRequest[];
}

/**
 * Places each live request at its pending approval item, in the newest turn that has one. Request ids
 * repeat across turns (each turn is a new provider process), so answered items never match.
 */
export function placeRequests(all: Turn[], requests: AgentRequest[]): Placement {
	const placement: Placement = { byTurn: new Map(), items: new Set(), loose: [] };
	for (const request of requests) {
		const key = requestKey(request.id);
		let found = false;
		for (let t = all.length - 1; t >= 0 && !found; t--) {
			const item = all[t]!.work.findLast(
				(i) => i.kind === 'approval' && i.status === 'pending' && requestKey(i.requestId) === key
			);
			if (!item || placement.items.has(item)) continue;
			placement.items.add(item);
			placement.byTurn.set(t, [...(placement.byTurn.get(t) ?? []), request]);
			found = true;
		}
		if (!found) placement.loose.push(request);
	}
	return placement;
}
