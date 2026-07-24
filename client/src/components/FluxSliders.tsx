import { RotateCcw } from "lucide-react";
import type { PrefDimension, PrefWeights } from "@shared/prefMatch.js";
import { weightsFor, BASE_WEIGHT } from "@shared/prefMatch.js";
import type { UserPrefs } from "@shared/types.js";

/**
 * The five things a commuter can actually trade off, plus emissions — which
 * used to be the "Greenest" chip these sliders replace, so it keeps a control
 * rather than quietly disappearing.
 */
const DIMENSIONS: { dim: PrefDimension; label: string }[] = [
  { dim: "time", label: "Travel time" },
  { dim: "transfers", label: "Fewer transfers" },
  { dim: "walking", label: "Less walking" },
  { dim: "crowds", label: "Avoid crowds" },
  { dim: "cost", label: "Save money" },
  { dim: "carbon", label: "Lower emissions" },
];

/**
 * Flux sliders (Phase 16) — per-dimension weights that order transit results
 * AND drive the "% match" badge, both through shared/prefMatch.ts, so the list
 * order and the score can never disagree.
 *
 * Until a slider is touched we don't write `prefWeights` at all: the bars show
 * what's already in effect (derived from the old Route priority pick, or the
 * flat baseline), so an untouched panel never invents a preference the user
 * didn't state — that's what keeps the match badge honest about staying hidden.
 */
export function FluxSliders({
  prefs,
  setPrefs,
}: {
  prefs: UserPrefs;
  setPrefs: (patch: Partial<UserPrefs>) => void;
}) {
  // What the engine is actually using right now — sliders mirror it exactly.
  const effective = weightsFor(prefs) ?? {};
  const valueOf = (dim: PrefDimension) => effective[dim] ?? BASE_WEIGHT;
  const customised = prefs.prefWeights != null;

  function setWeight(dim: PrefDimension, value: number) {
    // First touch materialises the whole set from what's in effect, so moving
    // one slider doesn't silently zero the others.
    const base: PrefWeights = {};
    for (const d of DIMENSIONS) base[d.dim] = valueOf(d.dim);
    setPrefs({ prefWeights: { ...base, [dim]: value } });
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">Transit — what matters to you</div>
        {customised && (
          <button
            onClick={() => setPrefs({ prefWeights: undefined })}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            <RotateCcw size={11} /> Reset
          </button>
        )}
      </div>
      <p className="mb-2.5 text-xs text-ripple-muted">
        Pull up what you care about. Options are ranked by the mix, and each one
        shows how well it matches.
      </p>
      <div className="flex flex-col gap-2.5">
        {DIMENSIONS.map(({ dim, label }) => (
          <label key={dim} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs">{label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={valueOf(dim)}
              onChange={(e) => setWeight(dim, Number(e.target.value))}
              aria-label={label}
              className="h-1.5 flex-1 cursor-pointer accent-[var(--match)]"
            />
          </label>
        ))}
      </div>
      {!customised && (
        <p className="mt-2 text-xs text-ripple-muted">
          Showing the balance in effect now — move any slider to make it yours.
        </p>
      )}
    </div>
  );
}
