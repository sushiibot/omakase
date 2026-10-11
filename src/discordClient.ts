import { Client, GatewayIntentBits, Partials } from "discord.js";

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration, // audit-log entries: screening records bans/kicks/timeouts as outcomes
    GatewayIntentBits.AutoModerationExecution, // AutoMod blocks, shown on screening posts
  ],
  // No DirectMessages intent: the bot never reads DMs.
  partials: [Partials.Message, Partials.Channel],
});
