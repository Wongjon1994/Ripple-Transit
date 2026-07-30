import { oneMapSearch } from "./onemap.js";
import type { FloodAlert } from "../../shared/types.js";

/**
 * PUB flash-flood alerts. Singapore has no public flood JSON API, so the
 * canonical source is PUB's own @PUBFloodAlerts channel; we read its public web
 * preview and geocode each affected road. Alerts warn to "avoid for the next 1
 * hour", so only recent ones are surfaced. Degrades silently if unavailable.
 */
const FEED = "https://t.me/s/PUBFloodAlerts";
const TTL_MS = 5 * 60 * 1000;
const RELEVANT_MS = 75 * 60 * 1000; // ~the "next 1 hour" window + a little slack
const MAX_GEOCODE = 10; // bound latency on a heavy-rain burst

let cache: { at: number; data: FloodAlert[] } | null = null;

function stripTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

export async function getFloodAlerts(): Promise<FloodAlert[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const res = await fetch(FEED, {
      headers: { "User-Agent": "Mozilla/5.0 (RippleTransit)" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return cache?.data ?? [];
    const html = await res.text();

    const texts = [
      ...html.matchAll(
        /<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)<\/div>/gs,
      ),
    ].map((m) => m[1]);
    const times = [...html.matchAll(/<time[^>]*datetime="([^"]+)"/g)].map(
      (m) => m[1],
    );

    const now = Date.now();
    // Location as PUB phrased it → its posted time (keep the most recent).
    const pending = new Map<string, number>();
    for (let i = 0; i < texts.length; i++) {
      const text = stripTags(texts[i]);
      if (!/flash flood/i.test(text)) continue;
      const posted = times[i] ? Date.parse(times[i]) : NaN;
      if (!Number.isFinite(posted) || now - posted > RELEVANT_MS) continue;
      const m = text.match(
        /next 1 hour:\s*(.*?)\s*(?:\[\d{1,2}:\d{2}\s*hours\]|$)/i,
      );
      if (!m) continue;
      for (const loc of m[1].split(";")) {
        const clean = loc.trim().replace(/[.;]+$/, "");
        if (clean.length > 2)
          pending.set(clean, Math.max(pending.get(clean) ?? 0, posted));
      }
    }

    const out: FloodAlert[] = [];
    for (const [location, posted] of [...pending].slice(0, MAX_GEOCODE)) {
      // Drop parentheticals ("(near …)", "(from … to …)") for the geocoder.
      const q = location.replace(/\(.*?\)/g, "").trim();
      const results = await oneMapSearch(q, 1).catch(() => []);
      const hit = results[0];
      if (hit)
        out.push({
          location,
          lat: hit.lat,
          lng: hit.lng,
          postedAtISO: new Date(posted).toISOString(),
        });
    }
    cache = { at: Date.now(), data: out };
    return out;
  } catch {
    return cache?.data ?? [];
  }
}
