import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, stack, test } from "../lib/harness.ts";

test("native mail accounts and owner policy use the real gateway tool bridge", async ({page, watch}) => {
  await openChat(page);
  const tag = nonce();
  const response = await page.request.get('/api/mail'); expect(response.ok()).toBe(true);
  const mail = await response.json(); expect(mail.accounts).toEqual([]);
  expect(mail.providers.map((p: {id: string}) => p.id)).toEqual(['gmail', 'fastmail']);
  const rules = `Draft only for property accounts ${tag}`;
  expect((await page.request.post('/api/tool-policy', {data: {rules}})).ok()).toBe(true);
  try {
    const text = `E2E-MAIL-ACCOUNTS #${tag}`; expect((await send(page, text)).status).toBe(202);
    await expect(bubble(page, `re-${tag}`)).toContainText('Read and save drafts only');
    const seen = await stack.waitForLlm(r => r.userText.includes(text)); expect(seen.tools).toContain('mail_save_draft'); expect(seen.tools).not.toContain('mail_send');
    const policyTag = nonce(); expect((await send(page, `E2E-TOOL-POLICY #${policyTag}`)).status).toBe(202);
    await expect(bubble(page, `re-${policyTag}`)).toContainText(rules);
    expect(await watch.violations()).toEqual([]);
  } finally { await page.request.post('/api/tool-policy', {data: {rules: ''}}); }
});
