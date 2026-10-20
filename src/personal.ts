import { accountsContribution } from "./accounts/toolContribution.ts";
import { Accounts } from "./accounts/service.ts";
import { AccountRoutes } from "./surfaces/web/accountRoutes.ts";
import { mailContributions, toolPolicyContribution, integrationsContribution, externalFilesContribution, machineFilesContribution, codingAgentsContribution, taskContribution, channelRequestsContribution } from "./orchestration/workspace/toolContributions.ts";
import { IntegrationBroker } from "./integrations/broker.ts";
import { dirname, join } from "node:path";
import { IntegrationSecrets, secretEncryptionKey } from "./integrations/secrets.ts";
import { Integrations } from "./integrations/service.ts";
import { IntegrationRoutes } from "./surfaces/web/integrationRoutes.ts";
import { createMailService } from "./integrations/mail/index.ts";
import { MailRoutes, TOOL_POLICY_KEY } from "./surfaces/web/mailRoutes.ts";
// The personal agent's server side: the web gateway for the PWA and the workspace control plane.
import { exitAfterBackoff } from "./crashBackoff.ts";
import { otelSDK } from "./telemetry.ts";
import { initDb, closeDb, getDb } from "./db/index.ts";
import { config } from "./config.ts";
import logger from "./logger.ts";
import { SqliteConversationStore } from "./core/stores/conversationStore.ts";
import { DiscordSpaceMemoryStore } from "./core/stores/memoryStore.ts";
import { transcribeAudio } from "./agent/transcribe.ts";
import { bootWorkspace, listenWorkspace } from "./orchestration/workspace/boot.ts";
import { resolveOwnerPrincipalId } from "./orchestration/transport/server.ts";
import { WorkspaceLinkStore } from "./db/workspaceLink.ts";
import { OwnerNameStore } from "./db/ownerName.ts";
import { createSettingsRoutes } from "./surfaces/web/settingsRoutes.ts";
import { personalConfig } from "./surfaces/web/config.ts";
import { TaskService } from "./surfaces/web/application/taskService.ts";
import { TaskRoutes } from "./surfaces/web/taskRoutes.ts";
import { BlockRoutes } from "./surfaces/web/blockRoutes.ts";
import { lastOwnerMessageAt } from "./surfaces/web/chatRoutes.ts";
import { FileStores } from "./orchestration/workspace/fileStores/service.ts";
import { FileStoreRoutes } from "./surfaces/web/fileStoreRoutes.ts";
import { MachineHub, machineGrants } from "./orchestration/machines/hub.ts";
import { MachineControl } from "./orchestration/machines/control.ts";
import { AgentEvents } from "./orchestration/machines/events.ts";
import { CodingAgentStore, CodingAgents } from "./orchestration/machines/agents.ts";
import { KvJsonState } from "./db/jsonState.ts";
import { pushFor } from "./surfaces/web/pushRules.ts";
import { sendPush } from "./surfaces/web/push.ts";
import { MachineRoutes } from "./surfaces/web/machineRoutes.ts";
import { createBrowserRoutes } from "./surfaces/web/browserRoutes.ts";
import { createDictationRoutes } from "./surfaces/web/dictationRoutes.ts";
import { createVoiceRoutes } from "./surfaces/web/voice/routes.ts";
import { createVoiceAgent } from "./surfaces/web/voice/agent.ts";
import { startWebGateway } from "./surfaces/web/server.ts";
import { createWebChat } from "./surfaces/web/chat.ts";
import { createUploadReadHandler } from "./surfaces/web/uploadRoutes.ts";
import { DiskUploadStore } from "./surfaces/web/uploads.ts";

async function main() {
  logger.info("Starting omakase gateway...");

  await initDb();
  logger.info({ path: config.databasePath }, "Database initialized");
  const db = getDb();

  const store = new SqliteConversationStore(db);
  const memory = new DiscordSpaceMemoryStore(db);
  const ownerPrincipalId = resolveOwnerPrincipalId();
  const ownerName = new OwnerNameStore(db);
  const uploads = new DiskUploadStore({
    root: personalConfig.webUploadsDir,
    db,
    // Fires only on an upload, which needs the web chat created below.
    onPhotoQuotaWarning: (used, cap) => void webChat.adapter.notifyPhotoQuota(used, cap),
  });
  // No break-glass: without a Discord client here, a held approval reaches the owner by push only.
  const workspace = bootWorkspace({
    principalId: ownerPrincipalId,
    enabled: personalConfig.dmWorkspaceEnabled,
    orchPort: personalConfig.orchPort,
    ownerDiscordId: config.ownerDiscordId,
    webOwnerLogin: process.env["WEB_OWNER_LOGIN"],
    store,
    memory,
    linkStore: new WorkspaceLinkStore(db),
    uploadRead: createUploadReadHandler(uploads, ownerPrincipalId),
    ownerName: () => ownerName.get(),
  });
  // Before the workspace transport listens, so the web adapter is registered by the time a workspace
  // connects and drains its outbox. It is registered only when the gateway started.
  const webChat = createWebChat({
    db,
    link: workspace.link,
    tools: workspace.tools,
    workspaceEnabled: personalConfig.dmWorkspaceEnabled,
    uploads,
  });
  const machines = new MachineHub(machineGrants.parse(JSON.parse(process.env.SUSHII_MACHINES_JSON ?? "[]")));
  workspace.server.setMachineHub(machines);
  const agentState = new KvJsonState(db);
  const integrationSecrets = new IntegrationSecrets(agentState, secretEncryptionKey(process.env.INTEGRATION_MASTER_KEY_FILE ?? join(dirname(config.databasePath), "integration-secrets.key"), agentState.list("integration-secret:").length > 0, !!process.env.INTEGRATION_MASTER_KEY_FILE));
  const accounts = new Accounts(db, secretEncryptionKey(process.env.ACCOUNTS_MASTER_KEY_FILE ?? join(dirname(config.databasePath), "accounts-secrets.key"), !!db.query("SELECT key FROM kv WHERE key LIKE 'accounts:v1:record:%' LIMIT 1").get(), !!process.env.ACCOUNTS_MASTER_KEY_FILE), ownerPrincipalId);
  workspace.tools.register(accountsContribution(raw => accounts.action(raw)));
  workspace.link.setAccountsInternal((conn, raw) => accounts.internal(conn, raw));
  const integrations = new Integrations(integrationSecrets, fetch, () => config.googleMapsApiKey, new IntegrationBroker(agentState, integrationSecrets));
  workspace.tools.register(integrationsContribution(raw => integrations.action(raw)));
  workspace.tools.setMapsKey(() => integrations.googleMapsKey());
  const mail = createMailService(agentState);
  for (const contribution of mailContributions((name, args) => mail.action(name, args))) workspace.tools.register(contribution);
  workspace.tools.register(toolPolicyContribution(() => agentState.get<string>(TOOL_POLICY_KEY) ?? ""));
  const machineControl = new MachineControl(machines, new CodingAgentStore(agentState));
  const codingAgents = new CodingAgents(machineControl);
  const machineRoutes = new MachineRoutes(machineControl, codingAgents);
  const fileStores = new FileStores(db);
  workspace.tools.register(externalFilesContribution(raw => fileStores.action(raw)));
  workspace.tools.register(machineFilesContribution(async raw => (raw as { action?: string })?.action === "list_machines" ? { machines: machineControl.list() } : machineControl.files(raw)));
  workspace.tools.register(codingAgentsContribution((args, conversationId, toolCallId) => codingAgents.action(args, conversationId, "agent", toolCallId)));
  const taskService = new TaskService(workspace.link, webChat.threads);
  const taskRoutes = new TaskRoutes(taskService, webChat.threads);
  workspace.tools.register(channelRequestsContribution(() => webChat.threads.pendingRequests()));
  workspace.tools.register(taskContribution((args, actor, conversationId) => taskService.action(args, actor, conversationId, "agent")));
  const agentEvents = new AgentEvents({
    control: machineControl,
    link: workspace.link,
    state: agentState,
    push: (event) => sendPush(pushFor(event)),
    lastOwnerMessageAt: (id) => {
      try {
        return lastOwnerMessageAt(webChat.threads.channel(id).log);
      } catch {
        return undefined;
      }
    },
  });
  machineControl.observer = agentEvents;
  machines.setSessionListener(agentEvents.onSession);
  const webVoice = createVoiceRoutes(process.env, createVoiceAgent(webChat.threads));
  const webServer = await startWebGateway(process.env, db, {
    chat: webChat.routes,
    threads: webChat.threads,
    tasks: taskRoutes,
    blocks: new BlockRoutes(workspace.link),
    machines: machineRoutes,
    fileStores: new FileStoreRoutes(fileStores),
    mail: new MailRoutes(mail, agentState),
    integrations: new IntegrationRoutes(integrations),
    accounts: new AccountRoutes(accounts),
    home: webChat.home,
    uploads,
    browser: createBrowserRoutes(workspace.link),
    reads: { db, link: workspace.link, connectors: workspace.link, memory: workspace.link, artifacts: workspace.link, maintenance: workspace.link, workspaceEnabled: personalConfig.dmWorkspaceEnabled },
    dictation: createDictationRoutes({ transcribe: transcribeAudio }),
    voice: webVoice,
    settings: createSettingsRoutes({ ownerName, onChange: (name) => workspace.link.ownerUpdate(name) }),
  });
  const stopWebChat = webServer ? webChat.start() : undefined;
  if (webServer) {
    workspace.registry.register(webChat.adapter);
    workspace.tools.setLocationRequests(webChat.location);
  }
  listenWorkspace(workspace, personalConfig.orchPort);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down...");
    // Open chat streams never end on their own, so a graceful stop would wait out its whole bound.
    webVoice.close();
    stopWebChat?.();
    // Graceful so in-flight push writes finish before the DB closes, but bounded to stay inside docker's 10s stop grace.
    if (webServer) await Promise.race([webServer.stop(), Bun.sleep(5000).then(() => webServer.stop(true))]);
    // A message still being routed marks itself routed in the DB; bounded, inside docker's 10s grace.
    if (webServer) await Promise.all([webChat.routes.drain(), webChat.threads.drain()]);
    // Before the DB closes, so no late workspace delivery writes to it.
    machineControl.deviceFiles.stop();
    workspace.server.stop();
    closeDb();
    try {
      await otelSDK?.shutdown();
    } catch (err) {
      logger.error({ err }, "Telemetry flush failed");
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(async (err) => {
  logger.error({ err }, "Fatal error");
  await exitAfterBackoff("personal");
});
