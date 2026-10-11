import { Client, GatewayIntentBits, Partials } from "discord.js";

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration, // audit-log entries: screening records bans/kicks/timeouts as outcomes
    GatewayIntentBits.AutoModerationExecution, // AutoMod blocks, shown on screening posts
  ],
  // No DirectMessages intent, so no DM events arrive. Channel lets discord.js emit events for channels
  // missing from its cache, such as guild threads it hasn't seen yet.
  partials: [Partials.Message, Partials.Channel],
});
