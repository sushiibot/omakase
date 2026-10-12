import { Client, GatewayIntentBits, Partials } from "discord.js";
import { config } from "./config.ts";

export function discordIntents(messageContent: boolean): GatewayIntentBits[] {
  return [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Privileged: requesting it before the app is approved fails login with "Used disallowed intents".
    ...(messageContent ? [GatewayIntentBits.MessageContent] : []),
    GatewayIntentBits.GuildModeration, // audit-log entries: screening records bans/kicks/timeouts as outcomes
    GatewayIntentBits.AutoModerationExecution, // AutoMod blocks, shown on screening posts
  ];
}

export const client = new Client({
  intents: discordIntents(config.discordMessageContent),
  // No DirectMessages intent, so no DM events arrive. Channel lets discord.js emit events for channels
  // missing from its cache, such as guild threads it hasn't seen yet.
  partials: [Partials.Message, Partials.Channel],
});
