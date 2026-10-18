import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, stack, test } from "../lib/harness.ts";

test("agent account credentials are encrypted, versioned, audited, and redacted before model requests", async ({ page }) => {
  test.setTimeout(120_000);
  await openChat(page);
  async function action(args: Record<string, unknown>) {
    const tag = nonce();
    const text = `E2E-ACCOUNT-ACTION ${JSON.stringify(args)} #${tag}`;
    expect((await send(page, text)).status).toBe(202);
    const request = await stack.waitForLlm(l => l.userText.includes(`#${tag}`) && l.lastRole === "tool");
    await expect(bubble(page, `re-${tag}`)).toBeVisible();
    return JSON.parse(request.lastTool!) as { account: { id: string; version: number; confirmedVersion?: number; status: string } };
  }
  const requestId = `create-${nonce()}`;
  const prepared = await action({ action: "prepare", name: "System test account", origin: "https://accounts.example.com", username: "owner@example.com", requestId, passwordPolicy: { minLength: 24, maxLength: 24 } });
  const account = prepared.account;
  expect(account.status).toBe("pending");
  const reveal = async (version?: number) => {
    const response = await page.request.post(`/api/accounts/${account.id}/reveal`, { data: { purpose: "reveal", ...(version === undefined ? {} : { version }) } });
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["cache-control"]).toContain("no-store");
    return await response.json() as { password: string; version: number };
  };
  const first = await reveal();
  expect(first.password).toHaveLength(24);
  const secondAccount = (await action({ action: "revise", accountId: account.id, expectedVersion: account.version, passwordPolicy: { minLength: 20, maxLength: 20, allowedSymbols: "!@" }, requestId: `revise-${nonce()}` })).account;
  const second = await reveal();
  expect(second.password).toHaveLength(20);
  expect(second.password).not.toBe(first.password);
  expect((await reveal(first.version)).password).toBe(first.password);
  await action({ action: "confirm", accountId: account.id, expectedVersion: secondAccount.version });
  const listed = await (await page.request.get("/api/accounts")).json();
  const saved = listed.accounts.find((a: { id: string }) => a.id === account.id);
  expect(saved.status).toBe("active");
  expect(JSON.stringify(listed)).not.toContain(second.password);
  const rows = await stack.query<{ value: string }>("select value from kv");
  expect(JSON.stringify(rows)).not.toContain(first.password);
  expect(JSON.stringify(rows)).not.toContain(second.password);
  // Deliberately supply a known secret to verify the final provider payload guard,
  // rather than assuming tool wrappers alone can keep it out of context.
  const tag = nonce();
  expect((await send(page, `E2E-ACCOUNT-LEAK ${first.password} ${second.password} #${tag}`)).status).toBe(202);
  const filtered = await stack.waitForLlm(l => l.userText.includes(`#${tag}`));
  expect(filtered.accountPayload).toBeTruthy();
  expect(filtered.accountPayload).not.toContain(first.password);
  expect(filtered.accountPayload).not.toContain(second.password);
  await expect(bubble(page, `re-${tag}`)).toBeVisible();
  const audit = await (await page.request.get(`/api/accounts/${account.id}/audit`)).json();
  expect(audit.events.length).toBeGreaterThanOrEqual(5);
  expect(JSON.stringify(audit)).not.toContain(first.password);
  expect(JSON.stringify(audit)).not.toContain(second.password);
  await stack.restartPersonal({ waitReady: true });
  expect((await reveal()).password).toBe(second.password);
  const archived = await page.request.post(`/api/accounts/${account.id}/archive`, { data: { expectedVersion: secondAccount.version } });
  expect(archived.ok()).toBeTruthy();
});
