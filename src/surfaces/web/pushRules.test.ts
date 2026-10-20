import { describe, expect, test } from "bun:test";
import { plainPushBody, pushFor } from "./pushRules.ts";

describe("pushFor", () => {
  test("maps each event to its tag, deep link and flags", () => {
    expect(pushFor({ kind: "approval", nonce: "n1", tool: "file_linear_issue" })).toEqual({
      title: "Approval needed",
      body: "sushii-agent needs your approval to run file_linear_issue",
      url: "/chat?approve=n1",
      tag: "approval:n1",
      requireInteraction: true,
    });
    expect(pushFor({ kind: "ask", askId: "a 1", question: "Which?" })).toEqual({ title: "The agent asks", body: "Which?", url: "/chat?ask=a%201", tag: "ask:a 1" });
    expect(pushFor({ kind: "auth" })).toMatchObject({ tag: "auth", body: "Sign-in link ready" });
    expect(pushFor({ kind: "reply", text: "done" })).toEqual({ title: "sushii-agent", body: "done", url: "/chat", tag: "chat", renotify: false });
    expect(pushFor({ kind: "reply", text: "done", key: "01J9Z3W8K2M4N6P8Q0R2S4T6V8" })).toMatchObject({ url: "/chat?m=01J9Z3W8K2M4N6P8Q0R2S4T6V8", tag: "chat" });
    expect(pushFor({ kind: "proactive", text: "x", key: "proactive-key" })).toMatchObject({ url: "/chat?m=proactive-key", tag: "chat" });
    expect(pushFor({ kind: "interrupted", message: "reply-of-turn" })).toMatchObject({ url: "/chat?m=reply-of-turn", tag: "chat" });
    expect(pushFor({ kind: "proactive", text: "" })).toMatchObject({ tag: "chat", body: "Sent a file" });
    expect(pushFor({ kind: "interrupted" })).toMatchObject({ tag: "chat", body: "Turn interrupted" });
    expect(pushFor({ kind: "quota", usedBytes: 4, capBytes: 5 })).toEqual({ title: "Photo storage almost full", body: "80% of the photo quota is used.", url: "/chat", tag: "quota" });
  });

  test("conversation links open the item in its own conversation, keeping their params", () => {
    expect(pushFor({ kind: "reply", text: "x", key: "reply-key-1" }, "trip-plans")).toMatchObject({ url: "/chats/trip-plans?m=reply-key-1", tag: "chat" });
    expect(pushFor({ kind: "ask", askId: "pick", question: "q" }, "trip-plans")).toMatchObject({ url: "/chats/trip-plans?ask=pick", tag: "ask:pick" });
    expect(pushFor({ kind: "approval", nonce: "n1", tool: "t" }, "task-t-login")).toMatchObject({ url: "/tasks/t-login?view=conversation&approve=n1" });
    expect(pushFor({ kind: "reply", text: "x", key: "reply-key-1" }, "task-t-login")).toMatchObject({ url: "/tasks/t-login?view=conversation&m=reply-key-1" });
    expect(pushFor({ kind: "auth" }, "trip-plans")).toMatchObject({ url: "/chats/trip-plans" });
    // A key that can't be a message id links to the conversation.
    expect(pushFor({ kind: "reply", text: "x", key: "o1" }, "trip-plans")).toMatchObject({ url: "/chats/trip-plans" });
    // Screens outside the conversation keep their own links.
    expect(pushFor({ kind: "inbox", key: "k", text: "t" }, "trip-plans")).toMatchObject({ url: "/inbox?item=msg%3Ak" });
  });

  test("an ask without an id falls back to the chat tag and still rings", () => {
    const p = pushFor({ kind: "ask", askId: "", question: "q" });
    expect(p).toMatchObject({ tag: "chat", url: "/chat" });
    expect(p.silent).toBeUndefined();
  });

  test("no push goes out silent", () => {
    for (const e of [{ kind: "approval", nonce: "n", tool: "t" }, { kind: "ask", askId: "a", question: "q" }, { kind: "reply", text: "x" }, { kind: "proactive", text: "x" }, { kind: "auth" }, { kind: "interrupted" }, { kind: "quota", usedBytes: 1, capBytes: 1 }] as const) {
      expect(pushFor(e).silent).toBeUndefined();
    }
  });
});

describe("plainPushBody", () => {
  test("strips markdown to plain text", () => {
    expect(plainPushBody("# Done\n\n**Bold** and _it_ with `code` and [a link](https://x.y)\n- item\n> quote")).toBe("Done Bold and it with code and a link item quote");
    expect(plainPushBody("```ts\nconst a = 1;\n```")).toBe("const a = 1;");
    expect(plainPushBody("snake_case_name stays")).toBe("snake_case_name stays");
  });

  test("cuts to 140 code points without splitting a surrogate pair", () => {
    const out = plainPushBody("😀".repeat(200));
    expect(Array.from(out)).toHaveLength(140);
    expect(out.endsWith("😀…")).toBe(true);
    expect(plainPushBody("a".repeat(140))).toBe("a".repeat(140));
  });
});
