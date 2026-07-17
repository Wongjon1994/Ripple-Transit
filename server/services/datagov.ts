/**
 * data.gov.sg dataset access: poll-download → signed URL → GeoJSON, plus a
 * single-flight daily cache helper shared by every consumer (active-mobility
 * networks, POI categories).
 */

export interface GeoJsonGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: Array<{ type: string; coordinates?: unknown }>;
}

export interface GeoJsonFeature {
  geometry?: GeoJsonGeometry;
  properties?: Record<string, unknown>;
}

export interface GeoJson {
  type: string;
  features?: GeoJsonFeature[];
}

const POLL_URL = (id: string) =>
  `https://api-open.data.gov.sg/v1/public/api/datasets/${id}/poll-download`;

// data.gov.sg rate-limits burst poll calls (429). Serialize downloads through
// one queue and retry a 429 once after a short pause.
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollOnce(id: string): Promise<Response> {
  return fetch(POLL_URL(id), { signal: AbortSignal.timeout(15_000) });
}

function fetchRaw(id: string): Promise<Response> {
  const run = queue.then(async () => {
    // poll-download returns a signed URL for the dataset file.
    let poll = await pollOnce(id);
    for (const backoff of [3_000, 8_000]) {
      if (poll.status !== 429) break;
      await sleep(backoff);
      poll = await pollOnce(id);
    }
    if (!poll.ok) throw new Error(`data.gov.sg poll failed: ${poll.status}`);
    const meta = (await poll.json()) as { data?: { url?: string } };
    const url = meta.data?.url;
    if (!url) throw new Error("data.gov.sg: no download url");
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`dataset download failed: ${res.status}`);
    // Small courtesy gap before the next queued poll (rate-limit hygiene).
    await sleep(800);
    return res;
  });
  // Chain the queue regardless of this download's outcome.
  queue = run.catch(() => undefined);
  return run;
}

export async function fetchDataset(id: string): Promise<GeoJson> {
  return (await (await fetchRaw(id)).json()) as GeoJson;
}

/** Raw text download for CSV datasets (e.g. NEA licence lists). */
export async function fetchDatasetText(id: string): Promise<string> {
  return (await fetchRaw(id)).text();
}

/** Minimal CSV parser: quoted fields, embedded commas/quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Wrap an async builder in a TTL cache with single-flight semantics:
 * concurrent callers share one in-flight build, failures aren't cached.
 */
export function dailyCache<T>(
  build: () => Promise<T>,
  ttlMs: number = DAY_MS,
): () => Promise<T> {
  let cache: { at: number; value: T } | null = null;
  let inFlight: Promise<T> | null = null;
  return async () => {
    if (cache && Date.now() - cache.at < ttlMs) return cache.value;
    inFlight ??= build()
      .then((value) => {
        cache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
