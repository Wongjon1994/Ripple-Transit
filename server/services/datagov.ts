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

export function fetchDataset(id: string): Promise<GeoJson> {
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
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`dataset download failed: ${res.status}`);
    const gj = (await res.json()) as GeoJson;
    // Small courtesy gap before the next queued poll (rate-limit hygiene).
    await sleep(800);
    return gj;
  });
  // Chain the queue regardless of this download's outcome.
  queue = run.catch(() => undefined);
  return run;
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
