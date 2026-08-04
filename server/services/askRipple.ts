import Anthropic from "@anthropic-ai/sdk";
import type { AskIntent } from "../../shared/types.js";

/**
 * Ask Ripple — the natural-language layer's parse step. Turns a commuter's
 * sentence into a structured route intent using a small, fast model
 * (Haiku 4.5). The model ONLY extracts what the user said; it never computes a
 * time, fare, distance, or route — the deterministic backend does that from the
 * fields it returns, preserving the "every figure is real data" promise. Strict
 * structured output guarantees the shape (the model emits fields, never prose).
 */

/** Strict JSON schema for the structured output (a raw schema, so it doesn't
 *  depend on the SDK's Zod-v4 helper — the project is on Zod v3). Structured
 *  outputs require `additionalProperties: false` and every key in `required`. */
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    from: nullableString,
    to: nullableString,
    mode: {
      anyOf: [{ type: "string", enum: ["transit", "walk", "cycle"] }, { type: "null" }],
    },
    timeMode: {
      anyOf: [{ type: "string", enum: ["leave", "arrive"] }, { type: "null" }],
    },
    time: nullableString,
    preferences: {
      type: "array",
      items: {
        type: "string",
        enum: ["time", "transfers", "walking", "crowds", "cost", "carbon"],
      },
    },
    understood: { type: "string" },
  },
  required: ["from", "to", "mode", "timeMode", "time", "preferences", "understood"],
} as const;

/** Thrown when no ANTHROPIC_API_KEY is configured — the feature stays disabled
 *  and the manual From/To flow is unaffected. */
export class AskNotConfiguredError extends Error {}

const SYSTEM = `You convert a Singapore commuter's natural-language request into a structured route search for Ripple Transit. Extract ONLY what the user actually states — never invent a destination, time, mode, or preference. Leave anything unstated as null (or an empty list). You do NOT compute routes, times, fares, crowd levels, or distances; a separate system does that from your fields.

Rules:
- from: the origin place/address named. If the user says "from here"/"my location", or gives no origin, set from to the literal string "current location". Otherwise the place text.
- to: the destination place/address. null if none is given.
- mode: "walk", "cycle", or "transit" (bus/train/MRT, and the default for getting somewhere). null if the user doesn't indicate one.
- time + timeMode: set time ONLY when the user gives an explicit clock time, as 24-hour "HH:MM"; otherwise null. For daytime commute phrasing assume the sensible hour ("by 6" → "18:00", "meeting at 9am" → "09:00"). timeMode is "arrive" for "by/before <time>", "leave" for "leave/depart at <time>". A relative time you cannot resolve to a clock ("in 10 min", "now") → time null, timeMode "leave".
- preferences: which of these the user emphasises — time (fastest/quickest), transfers (fewer changes/direct), walking (less walking), crowds (avoid crowds/quieter), cost (cheaper/save money), carbon (greener/lower emissions). Empty list if none.
- understood: ONE short plain-English line restating exactly what you extracted, e.g. "To Orchard MRT, arrive by 6 pm, less walking." Do not include any number the user didn't give.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AskNotConfiguredError("ANTHROPIC_API_KEY is not set");
  }
  // The SDK reads ANTHROPIC_API_KEY from the environment.
  client ??= new Anthropic();
  return client;
}

/**
 * Tidy the model's output: trim strings, drop a malformed time, default
 * timeMode when a time is present, and de-dupe preferences. Pure — unit-tested
 * so the intent→search mapping is verified even though the live model call
 * can't be exercised in the sandbox.
 */
export function normalizeIntent(raw: AskIntent): AskIntent {
  const time = raw.time && /^\d{2}:\d{2}$/.test(raw.time.trim()) ? raw.time.trim() : null;
  return {
    from: raw.from?.trim() || null,
    to: raw.to?.trim() || null,
    mode: raw.mode ?? null,
    // A time only means something with a leave/arrive sense; default to "leave".
    timeMode: time ? (raw.timeMode ?? "leave") : (raw.timeMode ?? null),
    time,
    preferences: [...new Set(raw.preferences ?? [])],
    understood: raw.understood?.trim() || "",
  };
}

export async function parseAsk(query: string): Promise<AskIntent> {
  const c = getClient();
  const message = await c.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system: SYSTEM,
    messages: [{ role: "user", content: query }],
    output_config: {
      format: { type: "json_schema", schema: INTENT_SCHEMA },
    },
  });
  // Structured output guarantees the text block is JSON matching the schema.
  const text = message.content.find((b) => b.type === "text")?.text;
  if (!text) {
    throw new Error("Could not extract a route intent from the request.");
  }
  return normalizeIntent(JSON.parse(text) as AskIntent);
}
