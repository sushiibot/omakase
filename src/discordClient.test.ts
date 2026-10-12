import { expect, test } from "bun:test";
import { GatewayIntentBits } from "discord.js";
import { client, discordIntents } from "./discordClient.ts";

test("the client never subscribes to DM events", () => {
  expect(client.options.intents.has(GatewayIntentBits.DirectMessages)).toBe(false);
});

test("MessageContent is requested only when the flag is on", () => {
  expect(discordIntents(false)).not.toContain(GatewayIntentBits.MessageContent);
  expect(discordIntents(true)).toContain(GatewayIntentBits.MessageContent);
  expect(discordIntents(false)).toContain(GatewayIntentBits.GuildMessages);
});

test("the client defaults to no MessageContent intent when DISCORD_MESSAGE_CONTENT is unset", () => {
  if (process.env["DISCORD_MESSAGE_CONTENT"] === "true") return;
  expect(client.options.intents.has(GatewayIntentBits.MessageContent)).toBe(false);
});
