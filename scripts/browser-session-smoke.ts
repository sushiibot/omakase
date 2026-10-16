// Real browser coverage: authentication data survives restart, takeover, and fallback.
import { mkdtempSync, rmSync } from "node:fs";
import { BrowserManager, localBrowserDriver } from "../src/workspace/browser.ts";
import type { BrowserEngine } from "../src/orchestration/browserContracts.ts";
const home = mkdtempSync("/tmp/browser-sessions-smoke-");
let ordinaryImages = 0;
let adImages = 0;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
  const url = new URL(req.url);
  if (url.pathname.endsWith(".gif")) {
    if (url.pathname.startsWith("/ads/banners/")) adImages++; else ordinaryImages++;
    return new Response(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"), { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
  }
  if (url.pathname === "/login") return new Response("signed in", { headers: { "Set-Cookie": "login=retained; HttpOnly; Max-Age=3600; SameSite=Lax; Path=/" } });
  if (url.pathname === "/account") return new Response(req.headers.get("cookie")?.includes("login=retained") ? "signed in" : "signed out");
  return new Response('<!doctype html><html><title>Login smoke</title><body><label>Name<input id="name" style="position:absolute;left:40px;top:40px;width:200px;height:40px"></label><button>Continue</button></body></html>', { headers: { "Content-Type": "text/html" } });
} });
const url = `http://127.0.0.1:${server.port}`;
const manager = new BrowserManager(home, localBrowserDriver(home));
try {
  const engines = (["chromium", "camoufox"] as BrowserEngine[]).filter(engine => !process.argv[2] || engine === process.argv[2]);
  if (!engines.length) throw new Error("Unknown browser engine");
  for (const engine of engines) {
    const binding = manager.bind("main", () => engine);
    const tool = binding.tool();
    const run = async (...args: string[]) => JSON.stringify(await tool.execute("smoke", { args, engine }, undefined, undefined, undefined as never));
    await run("open", url);
    if (!(await run("snapshot", "-i")).includes("Continue")) throw new Error(`${engine}: snapshot missing button`);
    const blockerDeadline = Date.now() + 15_000;
    do {
      ordinaryImages = 0; adImages = 0;
      await run("eval", "Promise.all(['/ordinary.gif', '/ads/banners/smoke.gif'].map(path => new Promise(resolve => { const image = new Image(); image.onload = image.onerror = () => resolve(true); image.src = path + '?probe=' + Math.random(); })))");
      if (ordinaryImages === 1 && adImages === 0) break;
      await Bun.sleep(250);
    } while (Date.now() < blockerDeadline);
    if (ordinaryImages !== 1 || adImages !== 0) throw new Error(`${engine}: ad blocker did not block the test image (${ordinaryImages}/${adImages}), page ${await run("get", "url")}`);
    const id = (await manager.read("main", false)).status!.id;
    await manager.control({ conversationId: "main", id, action: "takeover" });
    await manager.control({ conversationId: "main", id, action: "input", input: { kind: "click", x: 60, y: 60 } });
    await manager.control({ conversationId: "main", id, action: "input", input: { kind: "text", text: "owner" } });
    await manager.control({ conversationId: "main", id, action: "resume" });
    if (!(await run("get", "value", "#name")).includes("owner")) throw new Error(`${engine}: owner input failed`);
    await run("eval", "localStorage.setItem('smoke', 'retained'); true");
    await run("open", `${url}/login`);
    let frame;
    for (let i = 0; i < 100; i++) {
      frame = (await manager.read("main", true)).frame;
      if (frame) break;
      await Bun.sleep(100);
    }
    if (!frame || !frame.data.startsWith("/9j/")) throw new Error(`${engine}: preview missing`);
    await binding.finish();
    await run("open", `${url}/account`);
    if (!(await run("get", "text", "body")).includes("signed in")) throw new Error(`${engine}: login was lost on restart`);
    if (!(await run("eval", "localStorage.getItem('smoke')")).includes("retained")) throw new Error(`${engine}: localStorage was lost`);
    await binding.finish();
    console.log(`${engine}: ad blocking, saved login, owner input, snapshot, preview and restart passed`);
  }
} finally { await manager.dispose(); server.stop(true); rmSync(home, { recursive: true, force: true }); }
