import { expect, test } from "bun:test";
import { GatewayIntentBits } from "discord.js";
import { client } from "./discordClient.ts";

test("the client never subscribes to DM events", () => {
  expect(client.options.intents.has(GatewayIntentBits.DirectMessages)).toBe(false);
});
