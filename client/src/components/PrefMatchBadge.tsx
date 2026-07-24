import { Sparkles } from "lucide-react";
import type { PrefMatch } from "@shared/prefMatch.js";
import { PRIORITY_LABELS } from "@shared/prefMatch.js";
import type { UserPrefs } from "@shared/types.js";
import { cn } from "../lib/utils.js";

/**
 * Preference-match badge (Phase 16 §4.4) — a small SECONDARY mark. It rides the
 * demoted fare/CO₂ row on purpose: time and risk stay the hero, this is the
 * "and it happens to suit you" note, never the headline.
 */
export function PrefMatchBadge({
  match,
  className,
}: {
  match: PrefMatch;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "data-voice inline-flex shrink-0 items-center gap-1 rounded-full bg-match/12 px-1.5 py-0.5 text-[10px] font-semibold text-match",
        className,
      )}
      title="How well this option fits the route preferences you've set"
    >
      <Sparkles size={10} strokeWidth={2.5} />
      {match.score}% match
    </span>
  );
}

/**
 * The expanded "why" — what the score was built from, in the user's own terms.
 * Shown only inside an expanded card, so the percentage is never an unexplained
 * number sitting on a route.
 */
export function PrefMatchDetail({
  match,
  prefs,
}: {
  match: PrefMatch;
  prefs: UserPrefs;
}) {
  const priority = prefs.routePriority?.transit;
  const basis = prefs.prefWeights
    ? "your preference sliders"
    : priority && PRIORITY_LABELS[priority]
      ? `your preference for ${PRIORITY_LABELS[priority]}`
      : "your route preferences";
  const parts = [...match.reasons, ...match.caveats];

  return (
    <div className="flex items-start gap-1.5 text-xs text-ripple-muted">
      <Sparkles size={12} className="mt-0.5 shrink-0 text-match" />
      <span>
        <span className="font-medium text-match">{match.score}% match</span>{" "}
        {parts.length > 0 ? <>· {parts.join(" · ")} </> : null}
        <span className="opacity-80">
          — {basis}, scored only against the options in this search.
        </span>
      </span>
    </div>
  );
}
