import { z } from "zod";

const text = z.string().trim().min(1).max(500);
const center = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict();
export const mapsRequest = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search"), query: text,
    limit: z.number().int().min(1).max(20).default(5),
    near: center.optional(), radius: z.number().min(1).max(50000).optional(),
    openNow: z.boolean().optional(), minRating: z.number().min(0).max(5).optional(),
    type: z.string().regex(/^[a-z_]{1,80}$/).optional(),
    price: z.enum(["free", "inexpensive", "moderate", "expensive", "very_expensive"]).optional(),
    pageToken: z.string().min(1).max(4096).optional(),
  }).strict(),
  z.object({ action: z.literal("place"), id: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/), reviews: z.boolean().default(false) }).strict(),
  z.object({
    action: z.literal("directions"), origin: text, destination: text,
    mode: z.enum(["walk", "transit", "drive", "bicycle"]).default("walk"),
    departure: z.string().datetime({ offset: true }).optional(),
  }).strict(),
]).superRefine((p, ctx) => {
  if (p.action === "search" && p.radius !== undefined && !p.near)
    ctx.addIssue({ code: "custom", message: "--radius requires --near" });
  if (p.action === "directions") {
    if (p.mode === "transit" && !p.departure)
      ctx.addIssue({ code: "custom", message: "Transit requires --departure with a timezone offset or Z" });
    if (p.departure && !["transit", "drive"].includes(p.mode))
      ctx.addIssue({ code: "custom", message: "--departure is only supported for transit and drive" });
  }
});
export type MapsRequest = z.infer<typeof mapsRequest>;
