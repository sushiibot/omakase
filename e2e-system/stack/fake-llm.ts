// OpenAI-compatible chat-completions stand-in for OpenRouter. Replies are scripted by keywords in the
// last user message (see the README). A `#<tag>` in that message makes every reply start with
// `re-<tag>`, so a flow can find its own reply. GET /__log returns every request it has seen.
import { resolve } from "node:path";
import { stackConfig } from "./config.ts";

const { ports, addrs, model } = stackConfig();
const enc = new TextEncoder();
const seen: LlmRequest[] = [];
let n = 0;

// A flow holds a stream at a known chunk until it has exercised the concurrent operation.
const held = new Map<string, () => void>();

export interface LlmRequest {
  n: number;
  at: string;
  lastRole?: string;
  userText: string;
  images: number;
  lastImages: number;
  tools: string[];
  lastTool?: string;
  /** The user's name as the system prompt states it, when it does. */
  ownerName?: string;
}

type Part = { type?: string; text?: string };
type Msg = { role?: string; content?: unknown };

const chunk = (delta: object, finish: string | null, extra: object = {}) =>
  `data: ${JSON.stringify({ id: `gen-${n}`, object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
const usage = { usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return (content as Part[]).map((p) => (p?.type === "text" ? (p.text ?? "") : "")).join("\n");
  return "";
}

const imagesIn = (content: unknown) => (Array.isArray(content) ? (content as Part[]).filter((p) => p?.type === "image_url").length : 0);

function stream(pieces: string[], gapMs: number, tag: string | undefined, delayMs = 0, reasoning = false, holdAfter?: number): Response {
  if (tag) pieces = [`re-${tag} ${pieces[0] ?? ""}`, ...pieces.slice(1)];
  let cancelled = false;
  let release: (() => void) | undefined;
  const gate = holdAfter === undefined ? undefined : new Promise<void>((resolve) => { release = resolve; });
  if (gate && tag) held.set(tag, release!);
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
      release?.();
      if (tag) held.delete(tag);
    },
    async start(c) {
      try {
        await Bun.sleep(delayMs);
        if (reasoning) {
          c.enqueue(enc.encode(chunk({ role: "assistant", reasoning_content: "Private reasoning must never appear in chat." }, null)));
          await Bun.sleep(3000);
        }
        for (const [i, p] of pieces.entries()) {
          if (i === holdAfter) await gate;
          if (cancelled) return;
          c.enqueue(enc.encode(chunk({ role: "assistant", content: p }, null)));
          await Bun.sleep(gapMs);
        }
        if (cancelled) return;
        c.enqueue(enc.encode(chunk({}, "stop", usage)));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      } finally {
        if (tag) held.delete(tag);
      }
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function toolCall(name: string, args: object): Response {
  const call = { index: 0, id: `call_${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
  const body = chunk({ role: "assistant", tool_calls: [call] }, null) + chunk({}, "tool_calls", usage) + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function reply(msgs: Msg[], userText: string, lastUser: Msg | undefined): Response {
  const last = msgs[msgs.length - 1];
  const tag = /#([a-z0-9]{4,16})\b/.exec(userText)?.[1];
  // Consolidation now receives source conversations. Their old E2E keywords are evidence,
  // not commands for this run. Return a valid no-change proposal before matching chat scripts.
  if (userText.startsWith('Return only a JSON object: {"operations":[]')) {
    return stream([JSON.stringify({ operations: [], documents: [], summary: "No durable changes." })], 0, undefined);
  }
  if (/^Consolidate .*memory files\./.test(userText)) {
    const current = (name: string) => userText.split(`<current-file name="${name}">\n`)[1]?.split("\n</current-file>")[0] ?? `# ${name}`;
    return stream([
      "=====BEGIN USER.md=====\n", current("USER.md"), "\n=====END USER.md=====\n",
      "=====BEGIN MEMORY.md=====\n", current("MEMORY.md"), "\n=====END MEMORY.md=====\n",
      "=====BEGIN SUMMARY=====\nmerged: none\ndropped: none\npromoted: none\n=====END SUMMARY=====",
    ], 0, undefined);
  }
  if (last?.role === "tool") {
    if (userText.includes("E2E-ARTIFACT")) {
      const result = JSON.parse(textOf(last.content));
      return stream([result.link], 10, tag);
    }
    if (userText.includes("E2E-LIST-CHECKS") || userText.includes("E2E-OWNER-DECISION") || userText.includes("E2E-CHANNEL-REQUESTS") || userText.includes("E2E-MAIL-ACCOUNTS") || userText.includes("E2E-TOOL-POLICY")) return stream([textOf(last.content)], 10, tag);
    if (userText.includes("E2E-BROWSER")) return stream(["Browser is open. ", "Browser task finished."], 50, tag, 0, false, 1);
    return stream([`Tool finished. Result: ${textOf(last.content).slice(0, 160).replace(/\n/g, " ")}`], 50, tag);
  }
  if (userText.includes("E2E-ARTIFACT")) return toolCall("save_artifact", { title: `Report ${tag}`, content: `# Findings ${tag}\n\nDurable report evidence ${tag}.` });
  if (userText.includes("E2E-MAIL-ACCOUNTS")) return toolCall("mail_accounts", {});
  if (userText.includes("E2E-TOOL-POLICY")) return toolCall("tool_policy", {});
  if (userText.includes("E2E-EXTERNAL-FILES")) {
    const cli = resolve(import.meta.dir, "../../bin/external-files.ts");
    return toolCall("bash", { command: "bun '" + cli.replace(/'/g, "'\\''") + "' stores" });
  }
  if (userText.includes("E2E-CHANNEL-REQUESTS")) return toolCall("list_channel_requests", {});
  if (userText.includes("E2E-OWNER-DECISION")) {
    const key = /key-([a-z0-9]{4,16})\b/.exec(userText)?.[1] ?? tag ?? "test";
    return toolCall("request_owner_decision", { itemKey: `e2e:${key}`, decisionKey: "date", question: `Choose day for ${key}`, choices: ["Monday", "Tuesday"] });
  }
  if (userText.includes("E2E-BROWSER")) return toolCall("browser", { args: ["open", `http://${addrs.local}:${ports.llm}/browser-preview`] });
  // 400 is outside Pi's retryable errors, so the run fails at once.
  if (userText.includes("E2E-JOBFAIL")) return Response.json({ error: { message: "E2E-JOBFAIL scripted failure", code: 400 } }, { status: 400 });
  if (userText.includes("E2E-NOREPLY")) return stream(["NO_REPLY"], 10, undefined);
  if (userText.includes("E2E-LIST-CHECKS")) return toolCall("list_scheduled_checks", { includeFinished: true });
  if (userText.includes("E2E-SCHEDULE")) {
    const key = /key-([a-z0-9]{4,16})\b/.exec(userText)?.[1] ?? tag ?? "test";
    const taskId = /taskId:(t-[a-z0-9-]+)/.exec(userText)?.[1];
    return toolCall("schedule_check", {
      key: `e2e-${key}`, title: `E2E scheduled check ${key}`,
      prompt: `E2E-ECHO checked-${key} #w${key}`,
      at: new Date(Date.now() + 8000).toISOString(),
      ...(taskId ? { taskId } : {}),
    });
  }
  if (userText.includes("E2E-APPROVE")) {
    const title = `E2E approval ${tag ?? "test"}`;
    return toolCall("file_linear_issue", { repo_label: "sushii-agent", title, description: "Filed by the e2e fake model." });
  }
  if (userText.includes("E2E-PHOTO")) {
    const total = msgs.reduce((a, m) => a + imagesIn(m.content), 0);
    return stream([`I received ${imagesIn(lastUser?.content)} image part(s) in this turn `, `(${total} in the whole context).`], 100, tag);
  }
  if (userText.includes("E2E-THINK")) return stream(["Thoughtful reply."], 100, tag, 3000, true);
  if (userText.includes("E2E-WAIT")) return stream(["Reply without reasoning."], 100, tag, 3500);
  if (userText.includes("E2E-SLOW")) {
    const controlled = userText.includes("E2E-HOLD");
    return stream(Array.from({ length: 30 }, (_, i) => `slow${i} `), controlled ? 25 : 500, tag, 0, false, controlled ? 4 : undefined);
  }
  const echo = /E2E-ECHO (\S+)/.exec(userText);
  if (echo) return stream([`Echo ${echo[1]}.`], 10, tag, userText.includes("E2E-LATE") ? 4000 : 0, false, userText.includes("E2E-HOLD") ? 0 : undefined);
  const fill = /E2E-FILL-(\d+)/.exec(userText);
  if (fill) return stream([`Filler reply ${fill[1]}.`], 10, tag);
  return stream(["**Bold reply** with a list:\n\n", "- one\n- two\n\n", "```ts\nconst answer = 42;\nconsole.log(answer);\n```\n\n", "Done."], 400, tag);
}

Bun.serve({
  port: ports.llm,
  hostname: addrs.local,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/browser-preview") return new Response("<!doctype html><html><title>Browser preview test</title><body><h1>Browser preview test</h1><form><label>Name<input name=\"name\"></label><button>Continue</button></form></body></html>", { headers: { "content-type": "text/html" } });
    if (req.method === "POST" && url.pathname === "/__release") {
      const tag = url.searchParams.get("tag") ?? "";
      const release = held.get(tag);
      if (!release) return new Response("no held stream for tag", { status: 404 });
      release();
      held.delete(tag);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/__log") return Response.json(seen);
    if (url.pathname.endsWith("/models")) return Response.json({ data: [{ id: model, context_length: 400000 }] });
    if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
    n++;
    const body = (await req.json()) as { messages?: Msg[]; tools?: { function?: { name?: string } }[] };
    const msgs = body.messages ?? [];
    const last = msgs[msgs.length - 1];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const userText = textOf(lastUser?.content);
    seen.push({
      n,
      at: new Date().toISOString(),
      lastRole: last?.role,
      userText: userText.slice(0, 600),
      images: msgs.reduce((a, m) => a + imagesIn(m.content), 0),
      lastImages: imagesIn(lastUser?.content),
      tools: (body.tools ?? []).map((t) => t.function?.name ?? ""),
      lastTool: last?.role === "tool" ? textOf(last.content).slice(0, 400) : undefined,
      ownerName: /The user's name is (.+)\.$/m.exec(msgs.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n"))?.[1],
    });
    return reply(msgs, userText, lastUser);
  },
});
console.log(`fake llm on ${addrs.local}:${ports.llm}`);
