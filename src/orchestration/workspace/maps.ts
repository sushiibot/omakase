import { mapsRequest } from "../mapsContracts.ts";

const PLACE_FIELDS = ["id", "displayName", "formattedAddress", "location", "googleMapsUri", "businessStatus", "primaryType", "rating", "userRatingCount", "priceLevel", "currentOpeningHours", "attributions"];
const DETAILS_FIELDS = [...PLACE_FIELDS, "regularOpeningHours", "utcOffsetMinutes", "websiteUri", "nationalPhoneNumber", "movedPlaceId"];
type Transport = (url: string, init: RequestInit) => Promise<Response>;

/** Gateway-only API client. Fixed endpoints/masks; no API key or upstream error bodies leave it. */
export class GoogleMaps {
  private active = 0;
  private windowStart = 0;
  private requests = 0;
  constructor(private readonly key: () => string | undefined, private readonly transport: Transport = fetch, private readonly now = Date.now) {}

  async action(raw: unknown): Promise<unknown> {
    const parsed = mapsRequest.safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid maps request: ${parsed.error.issues[0]?.message}`);
    const p = parsed.data;
    const key = this.key();
    if (!key) throw new Error("Maps is not configured. Set GOOGLE_MAPS_API_KEY on the gateway and enable Places API (New) and Routes API.");
    if (this.active >= 4) throw new Error("Maps is busy. Wait before retrying.");
    if (this.now() - this.windowStart >= 60_000) { this.windowStart = this.now(); this.requests = 0; }
    if (this.requests >= 30) throw new Error("Maps request limit reached (30/minute). Wait before retrying.");
    this.requests++;
    this.active++;
    try {
      let url: string, mask: string, body: unknown;
      if (p.action === "search") {
        url = "https://places.googleapis.com/v1/places:searchText";
        mask = [...PLACE_FIELDS.map(f => `places.${f}`), "nextPageToken"].join(",");
        body = {
          textQuery: p.query, pageSize: p.limit,
          ...(p.near ? { locationBias: { circle: { center: p.near, radius: p.radius ?? 5000 } } } : {}),
          ...(p.openNow !== undefined ? { openNow: p.openNow } : {}),
          ...(p.minRating !== undefined ? { minRating: p.minRating } : {}),
          ...(p.type ? { includedType: p.type, strictTypeFiltering: true } : {}),
          ...(p.price ? { priceLevels: [`PRICE_LEVEL_${p.price.toUpperCase()}`] } : {}),
          ...(p.pageToken ? { pageToken: p.pageToken } : {}),
        };
      } else if (p.action === "place") {
        url = `https://places.googleapis.com/v1/places/${encodeURIComponent(p.id)}`;
        mask = [...DETAILS_FIELDS, ...(p.reviews ? ["reviews"] : [])].join(",");
      } else {
        url = "https://routes.googleapis.com/directions/v2:computeRoutes";
        mask = "routes.duration,routes.distanceMeters,routes.description,routes.warnings,routes.legs.steps.navigationInstruction,routes.legs.steps.transitDetails";
        const waypoint = (s: string) => s.startsWith("place:") ? { placeId: s.slice(6) } : { address: s };
        body = {
          origin: waypoint(p.origin), destination: waypoint(p.destination),
          travelMode: { walk: "WALK", transit: "TRANSIT", drive: "DRIVE", bicycle: "BICYCLE" }[p.mode],
          ...(p.departure ? { departureTime: p.departure } : {}),
          ...(p.mode === "drive" ? { routingPreference: "TRAFFIC_AWARE" } : {}),
        };
      }
      let response: Response;
      try {
        response = await this.transport(url, {
          method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(20_000),
          headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": mask, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch { throw new Error("Google Maps connection failed or timed out. No automatic retry was made."); }
      if (!response.ok) {
        await response.body?.cancel();
        const hint = response.status === 403 ? "Check the gateway key, enabled APIs, restrictions and billing." : response.status === 429 ? "Quota exceeded; wait or check the Google Cloud quota." : "Check the query, place ID or route parameters.";
        throw new Error(`Google Maps request failed (HTTP ${response.status}). ${hint}`);
      }
      let data: Record<string, unknown>;
      try {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty response");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 512 * 1024) throw new Error("Response too large");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
      catch { throw new Error("Google Maps returned an invalid response."); }
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Google Maps returned an invalid response.");
      return {
        source: "Google Maps", fetchedAt: new Date(this.now()).toISOString(),
        ...(p.action === "search" ? { places: data.places ?? [], ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}), ...(p.near ? { locationNote: "Location is a bias, not a strict radius." } : {}) }
          : p.action === "place" ? { place: data, ...(p.reviews ? { reviewNote: "At most five reviews, sorted by relevance; not a complete or latest-review sample." } : {}) }
          : { routes: data.routes ?? [], mode: p.mode, departure: p.departure ?? "now" }),
      };
    } finally { this.active--; }
  }
}
