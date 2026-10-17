import { z } from "zod";
import { phoneRoot, type DeviceFiles } from "../../orchestration/machines/deviceFs.ts";
import { json, readJson } from "./http.ts";
const session = z.string().uuid();
export async function deviceFsRoute(devices: DeviceFiles, req: Request, path: string): Promise<Response | null> {
  if (!path.startsWith("/api/machines/phone/")) return null;
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const raw = await readJson(req, 1600000);
  if (raw instanceof Response) return raw;
  if (path === "/api/machines/phone/connect") {
    const p = z.object({ id: z.string().regex(/^phone-[a-f0-9-]{36}$/), name: z.string().min(1).max(100), version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1), roots: z.array(phoneRoot).min(1).max(16).optional() }).strict().parse(raw);
    return json(devices.connect(p.id, p.name, p.version, p.roots));
  }
  if (path === "/api/machines/phone/poll") {
    const p = z.object({ session }).strict().parse(raw);
    return json(await devices.poll(p.session, req.signal));
  }
  if (path === "/api/machines/phone/result") {
    const p = z.object({ session, id: z.string().uuid(), result: z.unknown().optional(), error: z.string().max(1000).optional() }).strict().parse(raw);
    devices.result(p.session, p.id, p.result, p.error);
    return json({ ok: true });
  }
  if (path === "/api/machines/phone/disconnect") {
    const p = z.object({ session }).strict().parse(raw);
    devices.disconnect(p.session);
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}
