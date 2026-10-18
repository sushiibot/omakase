import { IntegrationBroker, BrokerError } from "./broker.ts";
import { z } from "zod";
import type { ToolManifestEntry } from "../orchestration/contracts.ts";
import { IntegrationSecrets } from "./secrets.ts";

export const integrationCatalog = [{
  id: "google_maps", name: "Google Maps", capability: "Search places and addresses with Places API (New)",
  setupUrl: "/connectors/keys",
  links: [
    { label: "Set up Google Maps", url: "https://developers.google.com/maps/documentation/places/web-service/get-api-key" },
    { label: "Open Google Cloud credentials", url: "https://console.cloud.google.com/apis/credentials" },
    { label: "Key restrictions", url: "https://developers.google.com/maps/api-security-best-practices" },
  ],
  steps: [
    "Choose a Google Cloud project, enable billing, and enable Places API (New). Enable Routes API if you want travel directions.",
    "Create an API key. Restrict it to Places API (New), Routes API if enabled, and your gateway's public outgoing IP address.",
    "Paste the key below. Save and test makes one Places request, which may incur a Google charge.",
  ],
}] as const;

export const integrationsManifest: ToolManifestEntry = {
  name: "integrations",
  description: "For new HTTP APIs, propose a definition from official docs, then offer the secure setup form. The owner approves the destination and ongoing operation access; never claim approval yourself. Use request for approved operations. The integrations CLI provides list, propose, request, and exec with a local proxy for compatible CLIs. Exact paths and JSON only; OAuth, request signing, binary/streaming and non-HTTP tools need dedicated adapters. Check live integration capabilities and credential status before using an external service. action=list returns supported services, whether a key is saved, and official setup instructions. When setup is needed, guide the owner in chat one step at a time: ask what they need and what account/project they have, find official links, and explain each next action. Do not just hand off a checklist. For Google Maps use the built-in integration, not a duplicate proposal. At the credential step, offer setupUrl as a Markdown link to the owner's secure form (Google Maps: select I already have a key);  never ask for keys in chat, env files, or memory. Keys are stored only on the gateway and cannot be read by agents. After the owner saves a key and selects Continue with agent or returns to chat, check status again and continue their task. google_maps_search uses the saved Google Maps key server-side. Missing keys and provider errors return setup guidance. Do not claim unsupported services are connected. Google results must be attributed to Google Maps and link to their googleMapsUri.",
  inputSchema: { type: "object", properties: { action: { type: "string", enum: ["list", "google_maps_search", "propose", "request"] }, query: { type: "string", minLength: 1, maxLength: 500 }, definition: { type: "object", description: "New integration: id, name, capability, origin (HTTPS origin), docsUrl, auth ({type: bearer} or {type: header, name}), operations [{id, description, method, path (exact), query (allowed names), body (boolean)}]. No secrets. Owner must approve in setup." }, request: { type: "object", description: "{integration, operation, query?: string-valued object, body?: JSON}. Only owner-approved operations." } }, required: ["action"], additionalProperties: false }, approval: "none",
};
const argsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("google_maps_search"), query: z.string().trim().min(1).max(500) }).strict(),
]);
export const credentialSchema = z.object({ key: z.string().trim().regex(/^[A-Za-z0-9_-]{20,256}$/) }).strict();

export class IntegrationError extends Error {}
export class Integrations {
  private revision = 0;
  constructor(private readonly secrets: IntegrationSecrets, private readonly fetchImpl: (input: string, init: RequestInit) => Promise<Response> = fetch, private readonly environmentKey: () => string | undefined = () => undefined, private readonly broker?: IntegrationBroker) {}
  /** Gateway-only accessor used by the existing Maps CLI service. Never exposed as a tool or route. */
  googleMapsKey(): string | undefined { return this.secrets.get("google_maps") ?? this.environmentKey(); }
  list() { return [...integrationCatalog.map(entry => ({ configured: this.secrets.has(entry.id) || !!this.environmentKey(), source: this.secrets.has(entry.id) ? "saved" : this.environmentKey() ? "environment" : null, ...entry })), ...(this.broker?.list() ?? [])]; }
  async save(id: string, raw: unknown) {
    if (id !== "google_maps") { if (!this.broker) throw new IntegrationError("Unknown integration."); this.broker.save(id, raw); return this.list(); }
    const parsed = credentialSchema.safeParse(raw);
    if (!parsed.success) throw new IntegrationError("Enter a valid API key.");
    const revision = ++this.revision;
    // Validate before replacing a working credential. Never persist rejected keys.
    await this.search(parsed.data.key, "Google Sydney", true);
    if (revision !== this.revision) throw new IntegrationError("Setup changed while testing. Refresh status before trying again.");
    this.secrets.set(id, parsed.data.key);
    return this.list();
  }
  remove(id: string) {
    if (id !== "google_maps") { if (!this.broker) throw new IntegrationError("Unknown integration."); this.broker.remove(id); return this.list(); }
    this.revision++;
    this.secrets.remove(id);
    return this.list();
  }
  async action(raw: unknown) {
    const generic = z.discriminatedUnion("action", [z.object({ action: z.literal("propose"), definition: z.unknown() }).strict(), z.object({ action: z.literal("request"), request: z.unknown() }).strict()]).safeParse(raw);
    if (generic.success && this.broker) {
      try { return generic.data.action === "propose" ? { integration: this.broker.propose(generic.data.definition) } : await this.broker.execute(generic.data.request); }
      catch (err) { return { error: err instanceof BrokerError ? err.message : "Integration request failed.", setupUrl: "/connectors/keys" }; }
    }
    const args = argsSchema.safeParse(raw);
    if (!args.success) throw new IntegrationError("Invalid integration request.");
    if (args.data.action === "list") return { integrations: this.list() };
    const key = this.googleMapsKey();
    if (!key) return { status: "setup_required", integration: this.list()[0] };
    try { return { source: "Google Maps", places: await this.search(key, args.data.query) }; }
    catch (err) { return { status: "unavailable", error: err instanceof IntegrationError ? err.message : "Google Maps is unavailable.", setupUrl: "/connectors/keys" }; }
  }
  private async search(key: string, query: string, validate = false) {
    try {
      const response = await this.fetchImpl("https://places.googleapis.com/v1/places:searchText", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": validate ? "places.id" : "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.attributions" },
        body: JSON.stringify({ textQuery: query, pageSize: validate ? 1 : 10 }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new IntegrationError(response.status === 429 ? "Google Maps quota reached. Check your project's quota and billing." : response.status === 400 || response.status === 401 || response.status === 403 ? "Google Maps rejected the request. Check the key, billing, Places API (New), and IP/API restrictions." : "Google Maps is unavailable. Try again later.");
      }
      // Never expose upstream error text, request headers, or reflected credential values.
      const body = JSON.parse(JSON.stringify(await response.json()).split(key).join("[redacted]")) as { places?: unknown[] };
      if (body.places !== undefined && !Array.isArray(body.places)) throw new Error("Invalid response");
      return body.places ?? [];
    } catch (err) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError("Could not reach Google Maps. Try again later.");
    }
  }
}
