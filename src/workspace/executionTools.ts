import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createAgentBashTool } from "../agentRuntime/piShared.ts";
import type { BrowserBinding } from "./browser.ts";
import type { GitHubCredentials } from "./githubCredentials.ts";
import { externalFilesSocket } from "./externalFiles.ts";
import { mapsSocket } from "./maps.ts";
import { integrationSocket } from "./integrations.ts";

/** Pi's bash under the agent env allowlist, minus PI_* (PI_CODING_AGENT_DIR and PI_SESSION_FILE point at the agent dir).
 *  `WS_RUN_ID` is the run in progress at spawn time, so `ws-runs` can default to it. */
export function createWorkspaceBashTool(cwd: string, currentRunId: () => string | null = () => null, github?: Pick<GitHubCredentials, "envFor">, browser?: BrowserBinding, stateDir?: string) {
  const extraEnv = (): Record<string, string> => {
    const runId = currentRunId();
    return { ...(runId ? { WS_RUN_ID: runId } : {}), ...(stateDir ? { EXTERNAL_FILES_SOCKET: externalFilesSocket(stateDir), MAPS_SOCKET: mapsSocket(stateDir), INTEGRATIONS_SOCKET: integrationSocket(stateDir) } : {}), ...browser?.env() };
  };
  const prepareEnv = github ? (command: string, dir: string) => github.envFor(command, dir) : undefined;
  return createAgentBashTool(cwd, extraEnv, { dropPrefixes: ["PI_"], exposeSessionEnvironment: false, prepareEnv });
}

/** Call from the session's event subscription and disposal boundary. Callers retain
 * their subscription order and decide whether to unsubscribe before or after Pi disposal. */
export function browserLifecycle(
  session: Pick<AgentSession, "isStreaming">,
  browser: Pick<BrowserBinding, "finish" | "touch"> | undefined,
  onError: (err: unknown) => void,
) {
  const finish = () => { void browser?.finish().catch(onError); };
  const heartbeat = browser ? setInterval(() => { if (session.isStreaming) browser.touch(); }, 60_000) : undefined;
  heartbeat?.unref();
  return {
    onEvent(event: Pick<AgentSessionEvent, "type">) {
      if (event.type === "agent_settled") finish();
    },
    dispose() {
      clearInterval(heartbeat);
      finish();
    },
  };
}
