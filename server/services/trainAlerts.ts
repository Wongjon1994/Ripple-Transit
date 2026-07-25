import { env } from "../env.js";

const BASE = "https://datamall2.mytransport.sg/ltaodataservice";
const TTL_MS = 60 * 1000; // train status changes on the minute scale

/**
 * LTA TrainServiceAlerts — the feed behind mytransport.sg/trainstatus.
 * `Status` 1 = normal, 2 = disrupted; `AffectedSegments` lists the live-hit
 * lines/stations; `Message[]` carries free-text notices (live + planned, MRT +
 * bus). We split it into live disruptions and planned MRT adjustments.
 */

/** TrainServiceAlerts Line codes → our network prefixes (mrtNetwork uses NS,
 *  EW, …; LRT loops split into two prefixes each). */
const LINE_MAP: Record<string, string[]> = {
  NSL: ["NS"],
  EWL: ["EW"],
  CGL: ["CG"],
  NEL: ["NE"],
  CCL: ["CC"],
  CEL: ["CE"],
  DTL: ["DT"],
  TEL: ["TE"],
  BPL: ["BP"],
  SLRT: ["SW", "SE"],
  PLRT: ["PW", "PE"],
};

export interface TrainDisruption {
  /** Our line prefixes affected (an LRT alert maps to both loop prefixes). */
  lines: string[];
  /** Affected station codes (e.g. "NS1"), for pinpointing on the map. */
  stations: string[];
  message: string;
}
export interface TrainPlanned {
  /** Line prefix this notice concerns, when we can identify it. */
  line?: string;
  /** Short human label (leading "TIME-CODE-" stripped, first sentence). */
  label: string;
}
export interface TrainAlerts {
  disrupted: boolean;
  disruptions: TrainDisruption[];
  planned: TrainPlanned[];
}

interface RawAlerts {
  value?: {
    Status?: number;
    AffectedSegments?: {
      Line?: string;
      Stations?: string;
      Direction?: string;
    }[];
    Message?: { Content?: string; CreatedDate?: string }[];
  };
}

let cache: { at: number; data: TrainAlerts } | null = null;

const EMPTY: TrainAlerts = { disrupted: false, disruptions: [], planned: [] };

/** Split a station string ("NS1,NS2 , EW24") into trimmed non-empty codes. */
function parseStations(s?: string): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * A Message[] entry looks like "23:30-DTL-Planned Service Adjustments. From …".
 * Return a planned MRT notice, or null for bus diversions / non-MRT chatter.
 */
export function parsePlanned(content?: string): TrainPlanned | null {
  if (!content) return null;
  // Bus diversions and stop notices aren't rail service — skip them here.
  if (/\bbus service/i.test(content)) return null;
  // Strip a leading "HH:MM-" or "DD/MM/YYYY HH:MM-" timestamp segment.
  let rest = content.replace(/^\s*(\d{1,2}\/\d{1,2}\/\d{2,4}\s+)?\d{1,2}:\d{2}\s*-\s*/, "");
  // Next segment is often the line code ("DTL-", "SK-"): capture + strip it.
  let line: string | undefined;
  const codeMatch = rest.match(/^([A-Z]{2,4})\s*-\s*/);
  if (codeMatch) {
    const raw = codeMatch[1];
    line = LINE_MAP[raw]?.[0] ?? (raw.length === 2 ? raw : undefined);
    rest = rest.slice(codeMatch[0].length);
  }
  // Only surface notices that actually concern rail.
  const railish =
    line != null || /\b(MRT|LRT|Line|Loop|train)\b/i.test(rest);
  if (!railish) return null;
  // First sentence, trimmed to a headline length.
  const sentence = rest.split(/(?<=\.)\s/)[0]?.trim() ?? rest.trim();
  const label = sentence.length > 90 ? sentence.slice(0, 87) + "…" : sentence;
  return { line, label };
}

export async function getTrainAlerts(): Promise<TrainAlerts> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const res = await fetch(`${BASE}/TrainServiceAlerts`, {
      headers: { AccountKey: env.LTA_ACCOUNT_KEY ?? "", Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return cache?.data ?? EMPTY;
    const raw = (await res.json()) as RawAlerts;
    const v = raw.value;
    if (!v) return cache?.data ?? EMPTY;

    const disruptions: TrainDisruption[] = (v.AffectedSegments ?? [])
      .map((seg) => ({
        lines: LINE_MAP[seg.Line ?? ""] ?? (seg.Line ? [seg.Line] : []),
        stations: parseStations(seg.Stations),
        message: (seg.Direction ?? "").trim(),
      }))
      .filter((d) => d.lines.length > 0);

    const planned: TrainPlanned[] = [];
    const seen = new Set<string>();
    for (const m of v.Message ?? []) {
      const p = parsePlanned(m.Content);
      if (p && !seen.has(p.label)) {
        seen.add(p.label);
        planned.push(p);
      }
    }

    const data: TrainAlerts = {
      disrupted: v.Status === 2 && disruptions.length > 0,
      disruptions,
      planned,
    };
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return cache?.data ?? EMPTY;
  }
}
