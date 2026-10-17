import { expect, test } from "bun:test";
import { GoogleMaps } from "./maps.ts";

test("search sends filters and fixed masks, preserves IDs, hours and attributions", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const place = { id: "abc", displayName: { text: "Cafe" }, rating: 4.5, userRatingCount: 200, currentOpeningHours: { openNow: true }, attributions: [{ provider: "source" }] };
  const maps = new GoogleMaps(() => "private-key", async (url, init) => {
    calls.push({ url, init });
    return Response.json({ places: [place], nextPageToken: "page2" });
  });
  const result = await maps.action({ action: "search", query: "coffee", near: { latitude: 52, longitude: 4 }, radius: 2000, limit: 8, openNow: true, minRating: 4, type: "cafe", price: "moderate" });
  expect(result).toMatchObject({ source: "Google Maps", places: [place], nextPageToken: "page2" });
  expect(JSON.stringify(result)).not.toContain("private-key");
  const call = calls[0]!;
  expect(call.url).toBe("https://places.googleapis.com/v1/places:searchText");
  expect(call.init.redirect).toBe("error");
  expect(call.init.headers).toMatchObject({ "X-Goog-Api-Key": "private-key" });
  const mask = new Headers(call.init.headers).get("X-Goog-FieldMask")!;
  expect(mask).not.toContain("*");
  expect(mask).not.toContain("reviews");
  expect(JSON.parse(call.init.body as string)).toEqual({ textQuery: "coffee", pageSize: 8, locationBias: { circle: { center: { latitude: 52, longitude: 4 }, radius: 2000 } }, openNow: true, minRating: 4, includedType: "cafe", strictTypeFiltering: true, priceLevels: ["PRICE_LEVEL_MODERATE"] });
});

test("details request reviews only explicitly, with author information intact", async () => {
  const masks: string[] = [];
  const review = { text: { text: "Good coffee" }, authorAttribution: { displayName: "Guest", uri: "https://example.com/author" }, googleMapsUri: "https://maps.google.com/review" };
  const maps = new GoogleMaps(() => "key", async (url, init) => {
    expect(url).toBe("https://places.googleapis.com/v1/places/abc");
    expect(init.method).toBe("GET");
    masks.push(new Headers(init.headers).get("X-Goog-FieldMask")!);
    return Response.json({ id: "abc", reviews: [review] });
  });
  await maps.action({ action: "place", id: "abc" });
  expect(await maps.action({ action: "place", id: "abc", reviews: true })).toMatchObject({ place: { reviews: [review] }, reviewNote: expect.stringContaining("five") });
  expect(masks[0]).not.toContain("reviews");
  expect(masks[1]).toContain("reviews");
});

test("routes preserve timezone and distinguish IDs from addresses; empty results stay empty", async () => {
  const maps = new GoogleMaps(() => "key", async (url, init) => {
    expect(url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(JSON.parse(init.body as string)).toEqual({ origin: { placeId: "abc" }, destination: { address: "Amsterdam Centraal" }, travelMode: "TRANSIT", departureTime: "2026-10-20T18:00:00+02:00" });
    return Response.json({});
  });
  expect(await maps.action({ action: "directions", origin: "place:abc", destination: "Amsterdam Centraal", mode: "transit", departure: "2026-10-20T18:00:00+02:00" })).toMatchObject({ routes: [], mode: "transit" });
});

test("gateway validates before fetching, never forwards raw errors, and bounds calls", async () => {
  let calls = 0;
  const maps = new GoogleMaps(() => "private-key", async () => { calls++; return new Response("private-key upstream trace", { status: 403 }); });
  for (const input of [
    { action: "search", query: "x", limit: 21 },
    { action: "search", query: "x", radius: 1 },
    { action: "search", query: "x", url: "https://evil.test" },
    { action: "place", id: "../other?key=x" },
    { action: "directions", origin: "a", destination: "b", mode: "transit" },
    { action: "directions", origin: "a", destination: "b", mode: "transit", departure: "2026-10-20T18:00:00" },
  ]) await expect(maps.action(input)).rejects.toThrow("Invalid maps request");
  expect(calls).toBe(0);
  await expect(new GoogleMaps(() => undefined).action({ action: "search", query: "x" })).rejects.toThrow("not configured");
  for (let i = 0; i < 30; i++) await expect(maps.action({ action: "search", query: "x" })).rejects.toThrow("HTTP 403");
  await expect(maps.action({ action: "search", query: "x" })).rejects.toThrow("30/minute");
  expect(calls).toBe(30);
  await expect(new GoogleMaps(() => "private-key", async () => { throw new Error("private-key"); }).action({ action: "search", query: "x" })).rejects.toThrow("connection failed");
});
