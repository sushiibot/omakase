import type { AgentDetail, AgentRecord, AgentSession, TranscriptItem } from './types';

// Sample agents for `?fake` and the e2e suite, one per state the panel shows. Times are relative to `now`.
export function agentFixtures(now = Date.now()): AgentDetail[] {
	const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
	const base = {
		machineId: 'pc',
		machineName: 'Desktop',
		rootId: 'code',
		conversationId: 'main'
	} satisfies Partial<AgentRecord>;
	const record = (
		patch: Partial<AgentRecord> & Pick<AgentRecord, 'id' | 'title'>
	): AgentRecord => ({
		...base,
		provider: 'codex',
		folder: 'Code/omakase',
		createdAt: at(30),
		updatedAt: at(1),
		...patch
	});
	const session = (patch: Partial<AgentSession>): AgentSession => ({
		status: 'running',
		attempts: 1,
		requests: [],
		output: '',
		...patch
	});

	const loginTranscript: TranscriptItem[] = [
		{
			kind: 'prompt',
			origin: 'agent',
			text: 'Fix the login redirect loop in omakase/web. Signing in from /settings sends the owner back to /login. Keep the change small and run the login tests.',
			at: at(14)
		},
		{ kind: 'message', text: 'Reading the auth guard and the login route first.', at: at(14) },
		{
			kind: 'command',
			command: 'rg -n "redirectTo" src',
			exitCode: 0,
			outputTail:
				'src/hooks.ts:41:  redirectTo(url)\nsrc/routes/login/+page.ts:12:  const next = url.searchParams.get("next")',
			at: at(13)
		},
		{
			kind: 'command',
			command: 'bun test e2e/login.test.ts',
			exitCode: 1,
			outputTail:
				'✗ returns to the requested page after sign-in\n  expected /settings, got /login\n1 fail, 6 pass',
			at: at(12)
		},
		{
			kind: 'fileChange',
			files: [
				{ path: 'src/hooks.ts', change: 'update' },
				{ path: 'src/routes/login/+page.ts', change: 'update' }
			],
			at: at(11)
		},
		{
			kind: 'command',
			command: 'bun test e2e/login.test.ts',
			exitCode: 0,
			outputTail: '7 pass',
			at: at(11)
		},
		{
			kind: 'message',
			final: true,
			text: 'Fixed the loop. The guard compared the **full URL** against `/login`, so `?next=` never matched.\n\n- `src/hooks.ts`: compare the pathname only\n- `src/routes/login/+page.ts`: accept only same-origin `next` values\n\nAll 7 login tests pass.',
			at: at(10)
		},
		{ kind: 'turnEnd', status: 'completed', at: at(10) },
		{ kind: 'prompt', origin: 'owner', text: 'Also check the logout path.', at: at(4) },
		{
			kind: 'command',
			command: 'rg -n "logout" src/routes',
			exitCode: 0,
			outputTail: 'src/routes/logout/+server.ts:8:  redirect(303, "/login")',
			at: at(3)
		},
		{
			kind: 'approval',
			requestId: 'req-logout',
			title: 'Run: bun test e2e/logout.test.ts',
			status: 'pending',
			at: at(2)
		}
	];
	const otelTranscript: TranscriptItem[] = [
		{
			kind: 'prompt',
			origin: 'agent',
			text: 'Add OpenTelemetry spans around the gateway request handler.',
			at: at(6)
		},
		{
			kind: 'tool',
			name: 'docs · search',
			detail: 'opentelemetry bun tracer',
			outputTail: '3 results',
			at: at(5)
		},
		{
			kind: 'fileChange',
			files: [
				{ path: 'src/telemetry.ts', change: 'add' },
				{ path: 'src/personal.ts', change: 'update' }
			],
			at: at(4)
		},
		{ kind: 'command', command: 'bun test src/surfaces/web', at: at(1) }
	];
	const drizzleTranscript: TranscriptItem[] = [
		{
			kind: 'prompt',
			origin: 'agent',
			text: 'Bump drizzle-orm to the latest minor and fix any type errors.',
			at: at(40)
		},
		{
			kind: 'command',
			command: 'bun add drizzle-orm@latest',
			exitCode: 0,
			outputTail: 'installed drizzle-orm@0.45.1',
			at: at(39)
		},
		{
			kind: 'command',
			command: 'bunx tsc --noEmit',
			exitCode: 2,
			outputTail: 'src/db/schema.ts(12,3): error TS2554: Expected 2 arguments, but got 1.',
			at: at(37)
		},
		{ kind: 'turnEnd', status: 'failed', error: 'bunx tsc --noEmit exited with 2', at: at(36) }
	];
	const sheetTranscript: TranscriptItem[] = [
		{
			kind: 'prompt',
			origin: 'owner',
			text: 'Shorten the sheet exit animation to 250ms and keep reduced motion instant.',
			at: at(80)
		},
		{
			kind: 'fileChange',
			files: [{ path: 'web/src/lib/ui/sheet/sheet.svelte', change: 'update' }],
			at: at(75)
		},
		{
			kind: 'command',
			command: 'bun run test:e2e e2e/sheet-motion.test.ts',
			exitCode: 0,
			outputTail: '6 passed',
			at: at(70)
		},
		{
			kind: 'message',
			final: true,
			text: 'The sheet now closes in 250ms. Reduced motion still closes instantly; `sheet-motion.test.ts` passes.',
			at: at(62)
		},
		{ kind: 'turnEnd', status: 'completed', at: at(62) }
	];

	return [
		{
			agent: record({
				id: 'a-login',
				title: 'Fix the login redirect',
				folder: 'Code/omakase/web',
				path: 'omakase/web',
				remoteStatus: 'needs-you',
				toolCallId: 'call-login',
				requests: 1,
				requestTitle: 'Run: bun test e2e/logout.test.ts',
				activity: 'Run: bun test e2e/logout.test.ts',
				createdAt: at(14),
				updatedAt: at(2)
			}),
			session: session({
				status: 'needs-you',
				attempts: 2,
				transcript: loginTranscript,
				requests: [
					{
						id: 'req-logout',
						description: 'Run: bun test e2e/logout.test.ts',
						decisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
						detail: {
							kind: 'command',
							command: 'bun test e2e/logout.test.ts',
							cwd: '/home/owner/code/omakase/web',
							reason: 'To confirm logout returns to /login'
						}
					}
				]
			})
		},
		{
			agent: record({
				id: 'a-drizzle',
				title: 'Bump drizzle-orm',
				provider: 'claude',
				machineName: 'Laptop',
				remoteStatus: 'failed',
				toolCallId: 'call-drizzle',
				error: 'bunx tsc --noEmit exited with 2',
				createdAt: at(40),
				updatedAt: at(36)
			}),
			session: session({
				status: 'failed',
				error: 'bunx tsc --noEmit exited with 2',
				transcript: drizzleTranscript
			})
		},
		{
			agent: record({
				id: 'a-otel',
				title: 'Add OTel spans to the gateway',
				remoteStatus: 'running',
				toolCallId: 'call-otel',
				activity: 'Running bun test src/surfaces/web',
				createdAt: at(6),
				updatedAt: at(1)
			}),
			session: session({ status: 'running', transcript: otelTranscript })
		},
		{
			agent: record({
				id: 'a-sheet',
				title: 'Refactor sheet motion',
				provider: 'claude',
				folder: 'Code/omakase/web',
				remoteStatus: 'completed',
				activity: 'The sheet now closes in 250ms.',
				createdAt: at(80),
				updatedAt: at(62)
			}),
			session: session({
				status: 'completed',
				final: 'The sheet now closes in 250ms.',
				transcript: sheetTranscript
			})
		},
		{
			agent: record({
				id: 'a-lint',
				title: 'Lint cleanup',
				remoteStatus: 'stopped',
				createdAt: at(200),
				updatedAt: at(190)
			}),
			session: session({
				status: 'stopped',
				transcript: [
					{ kind: 'prompt', origin: 'owner', text: 'Fix the lint warnings in web/.', at: at(200) },
					{
						kind: 'command',
						command: 'bun run lint',
						exitCode: 1,
						outputTail: '14 problems',
						at: at(195)
					},
					{ kind: 'turnEnd', status: 'stopped', at: at(190) }
				]
			})
		},
		{
			// A machine whose daemon predates transcripts: only the raw output tail.
			agent: record({
				id: 'a-notes',
				title: 'Summarise the deploy notes',
				machineName: 'File server',
				folder: 'Docs',
				remoteStatus: 'completed',
				createdAt: at(300),
				updatedAt: at(280)
			}),
			session: session({
				status: 'completed',
				final: 'The runbook matches the current deploy, except the rollback step.',
				output:
					'\nYou: Summarise the deploy notes\n\n$ cat docs/deploy.md\nThe runbook matches the current deploy, except the rollback step.'
			})
		}
	];
}
