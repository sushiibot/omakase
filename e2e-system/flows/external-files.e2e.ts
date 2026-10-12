import { existsSync } from "node:fs";
import { join } from "node:path";
import { bubble, openChat, send } from "../lib/chat.ts";
import { expect, nonce, stack, test } from "../lib/harness.ts";

test("agent accesses external files through bash and a skill without a model tool", async ({ page }) => {
  await openChat(page);
  expect(existsSync(join(stack.wsHome, ".agents/skills/external-files/SKILL.md"))).toBe(true);
  const tag = nonce();
  const text = `E2E-EXTERNAL-FILES #${tag}`;
  expect((await send(page, text)).status).toBe(202);
  await expect(bubble(page, `re-${tag}`)).toContainText(/Tool finished.*stores/, { timeout: 20_000 });
  const request = await stack.waitForLlm(l => l.userText.includes(text) && l.lastRole === "tool");
  expect(request.lastTool).toContain('"stores":[]');
  expect(request.tools).toContain("bash");
  expect(request.tools).not.toContain("external_files");
});
