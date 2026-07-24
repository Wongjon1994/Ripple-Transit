/**
 * Preference-match scoring (Phase 16, §4.4) — heuristic, no ML.
 *
 * A route's "match" is how well it fits what the user actually TOLD us they
 * care about, scored only against the other options in the same search. It is
 * deliberately relative: "92% match" means "of these options, this one fits
 * your stated preferences well", never an absolute claim about the route.
 *
 * The engine takes WEIGHTS per dimension so the Flux slider panel (next slice)
 * can feed real weights without a rewrite. Until the sliders exist, weights are
 * derived from the single stated `routePriority.transit` pick.
 *
 * Honesty rules baked in:
 *  - No stated preference → no score at all (`null`). We never invent a number.
 *  - A dimension the data can't support (e.g. no CO₂ on some options, no live
 *    crowd anywhere) is dropped from the score, not guessed at.
 *  - Every score carries the reasons and the caveats that produced it.
 */
import type { Itinerary, UserPrefs } from "./types.js";

/**
 * Scoreable dimensions. The first five are the Flux sliders from the seed
 * (travel time, fewer transfers, less walking, avoid crowds, save money);
 * `carbon` is engine-only — it exists to give the "greenest" route priority a
 * metric, and gets no slider of its own.
 */
export type PrefDimension =
  | "time"
  | "transfers"
  | "walking"
  | "crowds"
  | "cost"
  | "carbon";

export type PrefWeights = Partial<Record<PrefDimension, number>>;

export interface PrefMatch {
  /** 0–100, relative to the other options in this search. */
  score: number;
  /** What this option does well on the dimensions the user weighted. */
  reasons: string[];
  /** Where it works against a stated preference — shown, never hidden. */
  caveats: string[];
  /** Dimensions that actually fed the score (for the "how" explanation). */
  scored: PrefDimension[];
}

/** Weight given to dimensions the user hasn't singled out — they still matter
 *  a little (nobody wants the priciest, slowest option), just far less. */
const BASE_WEIGHT = 0.2;

/** Route priority → dimension weights, until the Flux sliders land. */
const PRIORITY_WEIGHTS: Record<string, PrefWeights> = {
  fastest: { time: 1 },
  fewest_transfers: { transfers: 1, time: 0.4 },
  least_walking: { walking: 1, time: 0.4 },
  greenest: { carbon: 1, walking: 0.3 },
};

/** Total seconds spent on foot (walk legs; cycling is its own mode/tab). */
export function walkSeconds(it: Itinerary): number {
  return it.legs.reduce((s, l) => (l.type === "walk" ? s + l.duration : s), 0);
}

/** Live platform crowding across the rail legs: high = 2, moderate = 1. */
function crowdLoad(it: Itinerary): number | null {
  const rail = it.legs.filter((l) => l.type === "mrt");
  if (rail.length === 0) return 0; // no rail = no platform crowding to face
  if (rail.every((l) => l.crowd == null)) return null; // no live data
  return rail.reduce(
    (s, l) => s + (l.crowd === "h" ? 2 : l.crowd === "m" ? 1 : 0),
    0,
  );
}

/** Per-dimension raw metric — lower is always better. `null` = unscoreable. */
function metric(it: Itinerary, dim: PrefDimension): number | null {
  switch (dim) {
    case "time":
      return it.duration;
    case "transfers":
      return it.transfers;
    case "walking":
      return walkSeconds(it);
    case "crowds":
      return crowdLoad(it);
    case "cost":
      return it.fare;
    case "carbon":
      return it.co2Grams ?? null;
  }
}

/** Resolve the weights to score with — explicit sliders win over the priority
 *  pick. Returns null when the user has stated nothing (→ no badge). */
export function weightsFor(prefs: UserPrefs): PrefWeights | null {
  const stated = prefs.prefWeights;
  if (stated && Object.values(stated).some((w) => (w ?? 0) > 0)) return stated;
  const priority = prefs.routePriority?.transit;
  if (!priority) return null;
  return PRIORITY_WEIGHTS[priority] ?? null;
}

const ALL_DIMENSIONS: PrefDimension[] = [
  "time",
  "transfers",
  "walking",
  "crowds",
  "cost",
  "carbon",
];

/**
 * Score every option in one search against the user's stated preferences.
 * Returns an entry per itinerary, aligned by index; all-null when nothing is
 * stated or there is only one option to compare.
 */
export function matchScores(
  itineraries: Itinerary[],
  prefs: UserPrefs,
): (PrefMatch | null)[] {
  const weights = weightsFor(prefs);
  // A single option has nothing to be relatively better than — a "100% match"
  // there would be meaningless.
  if (!weights || itineraries.length < 2)
    return itineraries.map(() => null);

  // Only dimensions every option can supply are scoreable.
  const usable = ALL_DIMENSIONS.filter((dim) => {
    if ((weights[dim] ?? BASE_WEIGHT) <= 0) return false;
    return itineraries.every((it) => metric(it, dim) != null);
  });
  if (usable.length === 0) return itineraries.map(() => null);

  const ranges = new Map<PrefDimension, { min: number; max: number }>();
  for (const dim of usable) {
    const vals = itineraries.map((it) => metric(it, dim) as number);
    ranges.set(dim, { min: Math.min(...vals), max: Math.max(...vals) });
  }

  return itineraries.map((it) => {
    let weighted = 0;
    let total = 0;
    const good: { dim: PrefDimension; weight: number }[] = [];
    const bad: { dim: PrefDimension; weight: number }[] = [];

    for (const dim of usable) {
      const w = weights[dim] ?? BASE_WEIGHT;
      const { min, max } = ranges.get(dim)!;
      const v = metric(it, dim) as number;
      // All options equal on this dimension → nobody wins or loses on it.
      const norm = max > min ? 1 - (v - min) / (max - min) : 1;
      weighted += w * norm;
      total += w;
      // Only dimensions the user actually weighted up earn a mention.
      if (w > BASE_WEIGHT && max > min) {
        if (norm >= 0.75) good.push({ dim, weight: w });
        else if (norm <= 0.25) bad.push({ dim, weight: w });
      }
    }

    const byWeight = (
      a: { weight: number },
      b: { weight: number },
    ) => b.weight - a.weight;

    return {
      score: Math.round((weighted / total) * 100),
      reasons: good.sort(byWeight).map(({ dim }) => praise(it, dim)),
      caveats: bad.sort(byWeight).map(({ dim }) => caveat(it, dim)),
      scored: usable,
    };
  });
}

function praise(it: Itinerary, dim: PrefDimension): string {
  switch (dim) {
    case "time":
      return "quickest of these options";
    case "transfers":
      return it.transfers === 0 ? "no transfers" : "fewest transfers";
    case "walking":
      return `least walking (~${Math.round(walkSeconds(it) / 60)} min)`;
    case "crowds":
      return "quieter platforms right now";
    case "cost":
      return `cheapest ($${it.fare.toFixed(2)})`;
    case "carbon":
      return "lowest CO₂";
  }
}

function caveat(it: Itinerary, dim: PrefDimension): string {
  switch (dim) {
    case "time":
      return "slowest of these options";
    case "transfers":
      return `${it.transfers} transfer${it.transfers > 1 ? "s" : ""}`;
    case "walking":
      return `most walking (~${Math.round(walkSeconds(it) / 60)} min)`;
    case "crowds":
      return "crowded platform on this route";
    case "cost":
      return `priciest ($${it.fare.toFixed(2)})`;
    case "carbon":
      return "highest CO₂ of these";
  }
}

/** Label for the "why" line — what the user's stated preference actually is. */
export const PRIORITY_LABELS: Record<string, string> = {
  fastest: "the quickest trip",
  fewest_transfers: "fewer transfers",
  least_walking: "less walking",
  greenest: "lower emissions",
};
