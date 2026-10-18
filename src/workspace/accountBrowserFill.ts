/** Executed atomically in the selected page. No asynchronous gap after origin validation. */
export function fillAccountPage(input: { origin: string; fields: { password: string; confirmPassword?: string; username?: string }; password: string; username: string }): boolean {
  if (location.origin !== input.origin || location.protocol !== "https:") throw new Error("Account fill refused");
  const find = (selector: string) => {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length !== 1 || !(nodes[0] instanceof HTMLInputElement)) throw new Error("Account fill refused");
    const element = nodes[0];
    if (element.disabled || element.readOnly || !element.isConnected) throw new Error("Account fill refused");
    return element;
  };
  const password = find(input.fields.password);
  const confirm = input.fields.confirmPassword ? find(input.fields.confirmPassword) : undefined;
  const username = input.fields.username ? find(input.fields.username) : undefined;
  if (password.type !== "password" || confirm && confirm.type !== "password" || username && !["text", "email"].includes(username.type)) throw new Error("Account fill refused");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  // Set both before notifying page handlers (which might navigate).
  setter.call(password, input.password);
  if (confirm) setter.call(confirm, input.password);
  if (username) setter.call(username, input.username);
  password.dispatchEvent(new Event("input", { bubbles: true }));
  password.dispatchEvent(new Event("change", { bubbles: true }));
  if (confirm) { confirm.dispatchEvent(new Event("input", { bubbles: true })); confirm.dispatchEvent(new Event("change", { bubbles: true })); }
  if (username) { username.dispatchEvent(new Event("input", { bubbles: true })); username.dispatchEvent(new Event("change", { bubbles: true })); }
  return true;
}

/** Private CDP channel: credential values never pass through CLI args or command broadcasts. */
export async function chromiumAccountFill(endpoint: string, marker: string, input: Parameters<typeof fillAccountPage>[0], signal?: AbortSignal) {
  const url = new URL(endpoint.trim());
  if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Account fill refused");
  const socket = new WebSocket(url);
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  let id = 0;
  const fail = () => { for (const p of pending.values()) p.reject(new Error("Account fill failed")); pending.clear(); socket.close(); };
  const timeout = setTimeout(fail, 30_000);
  signal?.addEventListener("abort", fail, { once: true });
  try {
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("Account fill failed")); socket.onclose = () => reject(new Error("Account fill failed")); });
    socket.onclose = fail;
    socket.onerror = fail;
    socket.onmessage = (event) => {
      try { const msg = JSON.parse(String(event.data)); const p = pending.get(msg.id); if (!p) return; pending.delete(msg.id); if (msg.error) p.reject(new Error("Account fill failed")); else p.resolve(msg.result); } catch { fail(); }
    };
    const call = (method: string, params: unknown, sessionId?: string) => new Promise<any>((resolve, reject) => {
      if (signal?.aborted || socket.readyState !== WebSocket.OPEN) { reject(new Error("Account fill failed")); return; }
      const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const { targetInfos } = await call("Target.getTargets", {});
    for (const target of targetInfos.filter((t: any) => t.type === "page")) {
      const { sessionId } = await call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
      try {
        const match = await call("Runtime.evaluate", { expression: `globalThis[${JSON.stringify(marker)}] === true`, returnByValue: true }, sessionId);
        if (match.result?.value !== true) continue;
        const result = await call("Runtime.evaluate", { expression: `(${fillAccountPage.toString()})(${JSON.stringify(input)})`, returnByValue: true }, sessionId);
        if (result.exceptionDetails || result.result?.value !== true) throw new Error("Account fill failed");
        return;
      } finally { await call("Target.detachFromTarget", { sessionId }); }
    }
    throw new Error("Account fill failed");
  } catch { throw new Error("Account fill failed"); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", fail); socket.onclose = null; socket.close(); }
}
