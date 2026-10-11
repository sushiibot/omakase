// Test-only preload: login resolves without connecting, so the gateway never opens and ClientReady never fires.
import { client } from "../discordClient.ts";

client.login = async () => {
  console.error("[test] discord client.login stubbed; gateway not connected");
  return "stub";
};
