import { describe, expect, test } from "bun:test";
import type { SurfaceCapabilities, SurfaceSession, ToolHosts } from "../contracts.ts";
import { ALL_TOOL_ENTRIES, createToolRegistry, type ToolAvailability } from "./registry.ts";

const AVAILABLE: ToolAvailability = { exa: true, grafanaBaseUrl: true, linear: true };

const ALL_CAPS: SurfaceCapabilities = {
  richComponents: true,
  customEmoji: true,
  nativeTimestamps: true,
  threads: true,
  reactions: true,
  progress: true,
  interactiveChoices: true,
  typing: true,
  replyTo: true,
};

function fakeSession(hosts: ToolHosts = {}, capabilities: SurfaceCapabilities = ALL_CAPS): SurfaceSession {
  return { capabilities, hosts };
}

const SPACE = { surface: "web" as const, spaceId: "dm", authorized: true };

function names(space: Parameters<ReturnType<typeof createToolRegistry>["resolve"]>[1], availability = AVAILABLE, caps = ALL_CAPS) {
  return createToolRegistry(undefined, () => availability).resolve(fakeSession({}, caps), space).map((e) => e.name);
}

describe("CoreToolRegistry", () => {
  test("every declared tool name is unique", () => {
    const all = ALL_TOOL_ENTRIES.map((e) => e.name);
    expect(new Set(all).size).toBe(all.length);
  });

  test("web_search/fetch_url_content hidden when no Exa key is configured", () => {
    const out = names(SPACE, { ...AVAILABLE, exa: false });
    expect(out).not.toContain("web_search");
    expect(out).not.toContain("fetch_url_content");
    expect(out).toContain("search_logs");
  });

  test("ops tools hidden from an unauthorized caller, even with credentials set", () => {
    const out = names({ ...SPACE, authorized: false });
    expect(out).not.toContain("search_logs");
    expect(out).not.toContain("get_trace");
    expect(out).not.toContain("file_linear_issue");
    expect(out).toContain("web_search");
  });

  test("Grafana tools hidden without a Grafana base URL, Linear tools unaffected", () => {
    const out = names(SPACE, { ...AVAILABLE, grafanaBaseUrl: false });
    expect(out).not.toContain("search_logs");
    expect(out).toContain("file_linear_issue");
  });

  test("Linear tools hidden without both a Linear API key and team id", () => {
    const out = names(SPACE, { ...AVAILABLE, linear: false });
    expect(out).not.toContain("file_linear_issue");
    expect(out).toContain("search_logs");
  });

  test("ask_question needs interactiveChoices", () => {
    expect(names(SPACE)).toContain("ask_question");
    expect(names(SPACE, AVAILABLE, { ...ALL_CAPS, interactiveChoices: false })).not.toContain("ask_question");
  });

  test("update_profile only for the owner in a private space", () => {
    expect(names({ ...SPACE, isOwner: true, isPrivate: true })).toContain("update_profile");
    expect(names({ ...SPACE, isOwner: true, isPrivate: false })).not.toContain("update_profile");
    expect(names({ ...SPACE, isOwner: false, isPrivate: true })).not.toContain("update_profile");
  });

  test("default availability reads the live config without throwing", () => {
    const out = createToolRegistry().resolve(fakeSession(), SPACE).map((e) => e.name);
    expect(out).toContain("memory");
  });
});
