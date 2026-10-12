import { afterEach, describe, expect, test } from "bun:test";
import { AuditLogEvent, type AutoModerationActionExecution, type Client, type GuildAuditLogsEntry, type Message } from "discord.js";
import { config } from "../../config.ts";
import { actionFor, handleScreeningAutomod, screenDiscordMessage } from "./screening.ts";

function entry(action: AuditLogEvent, changes: { key: string; old?: unknown; new?: unknown }[] = []): GuildAuditLogsEntry {
  return { action, changes } as unknown as GuildAuditLogsEntry;
}

describe("actionFor", () => {
  test("bans, kicks and timeouts count as mod actions", () => {
    expect(actionFor(entry(AuditLogEvent.MemberBanAdd))).toBe("banned");
    expect(actionFor(entry(AuditLogEvent.MemberKick))).toBe("kicked");
    expect(actionFor(entry(AuditLogEvent.MemberUpdate, [{ key: "communication_disabled_until", new: "2026-10-01T00:00:00Z" }]))).toBe("timed out");
  });

  test("removing a timeout, nick changes and other events are ignored", () => {
    expect(actionFor(entry(AuditLogEvent.MemberUpdate, [{ key: "communication_disabled_until", old: "x", new: undefined }]))).toBeNull();
    expect(actionFor(entry(AuditLogEvent.MemberUpdate, [{ key: "nick", new: "bob" }]))).toBeNull();
    expect(actionFor(entry(AuditLogEvent.MessageDelete))).toBeNull();
  });
});

/** An object that records every property read, so a test can tell whether a handler looked at it. */
function recording<T>(reads: string[], base: Record<string, unknown> = {}): T {
  return new Proxy(base, {
    get(target, key) {
      reads.push(String(key));
      return target[key as string];
    },
  }) as T;
}

describe("screening without the MessageContent intent", () => {
  const saved = config.discordMessageContent;
  afterEach(() => {
    config.discordMessageContent = saved;
  });

  test("screenDiscordMessage returns before reading the message", () => {
    config.discordMessageContent = false;
    const reads: string[] = [];
    screenDiscordMessage({} as Client, recording<Message<true>>(reads));
    expect(reads).toEqual([]);
  });

  test("handleScreeningAutomod returns before reading the execution", () => {
    config.discordMessageContent = false;
    const reads: string[] = [];
    handleScreeningAutomod({} as Client, recording<AutoModerationActionExecution>(reads));
    expect(reads).toEqual([]);
  });

  test("screenDiscordMessage reads the message when the flag is on", () => {
    config.discordMessageContent = true;
    const reads: string[] = [];
    screenDiscordMessage({} as Client, recording<Message<true>>(reads, { guildId: "unconfigured-guild" }));
    expect(reads).toContain("guildId");
  });
});
