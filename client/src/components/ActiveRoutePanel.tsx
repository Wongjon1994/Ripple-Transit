import { useEffect, useState } from "react";
import {
  Footprints,
  Bike,
  Navigation,
  Loader2,
  CloudRain,
  Sun,
  ThermometerSun,
  Zap,
  Umbrella,
  TreePine,
  Leaf,
  Flame,
  TriangleAlert,
  ChevronDown,
} from "lucide-react";
import type {
  ActiveMode,
  ActiveRoutesResult,
  ActiveVariant,
  ActiveVariantKind,
} from "@shared/types.js";
import { fmtDuration, fmtDistance, cn } from "../lib/utils.js";
import { Button } from "./ui.js";
import { LiveArrivals } from "./LiveArrivals.js";

const LONG_WALK_M = 8000;

const KIND_META: Record<
  ActiveVariantKind,
  { label: string; Icon: typeof Zap; cls: string }
> = {
  fastest: { label: "Fastest", Icon: Zap, cls: "bg-gold/15 text-gold" },
  sheltered: {
    label: "Most sheltered",
    Icon: Umbrella,
    cls: "bg-brand/10 text-brand",
  },
  pcn: { label: "PCN scenic", Icon: TreePine, cls: "bg-ok/10 text-ok" },
};

function KindTag({ kind }: { kind: ActiveVariantKind }) {
  const { label, Icon, cls } = KIND_META[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em]",
        cls,
      )}
    >
      <Icon size={11} /> {label}
    </span>
  );
}

function AdvisoryStrip({
  advisory,
  area,
}: {
  advisory: ActiveRoutesResult["advisory"];
  area?: string;
}) {
  const Icon =
    advisory.level === "warning"
      ? CloudRain
      : advisory.level === "info"
        ? ThermometerSun
        : Sun;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-xs",
        advisory.level === "warning"
          ? "bg-warning/10 text-warning"
          : advisory.level === "info"
            ? "bg-brand/10 text-brand"
            : "bg-ok/10 text-ok",
      )}
    >
      <Icon size={14} className="shrink-0" />
      <span className="font-medium">
        {advisory.message}
        {advisory.level === "good" && area ? ` (near ${area})` : ""}
      </span>
    </div>
  );
}

function MetricBar({
  label,
  pct,
  color,
}: {
  label: string;
  pct: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow text-[10px] text-ripple-muted">{label}</span>
        <span className="data-voice text-xs font-semibold text-[var(--fg)]">
          {pct}%
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ripple-muted/15">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(2, pct)}%`, background: color }}
        />
      </div>
    </div>
  );
}

/**
 * Walk / Cycle tab: real alternate paths per journey — Fastest, Most
 * sheltered (walk, OSM covered walkways), PCN scenic — each comfort-scored.
 * Flavours whose best path is the same route merge into badges.
 */
export function ActiveRoutePanel({
  mode,
  data,
  isLoading,
  selected,
  onSelect,
  onStartJourney,
  collapseKey,
  liveBoardStopCode,
  preferredKind,
  onExpandChange,
}: {
  mode: ActiveMode;
  data: ActiveRoutesResult | undefined;
  isLoading: boolean;
  selected: number;
  onSelect: (i: number) => void;
  onStartJourney: (variant: ActiveVariant) => void;
  /** Collapse all cards when this changes (i.e. on a new search). */
  collapseKey?: string;
  /** Walking to a bus stop: show its live arrival board inline (Tier 3). */
  liveBoardStopCode?: string | null;
  /** The route flavour the user asked for — so we can say when none exists. */
  preferredKind?: ActiveVariantKind;
  /** Notifies the parent when a card is expanded, so the sticky search header
   *  can unfreeze to give the expanded content room. */
  onExpandChange?: (expanded: boolean) => void;
}) {
  // §9: cards render Tier-1 only until tapped; selection (map) is separate.
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  useEffect(() => setExpandedIdx(null), [collapseKey, mode]);
  useEffect(
    () => onExpandChange?.(expandedIdx !== null),
    [expandedIdx, onExpandChange],
  );
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-ripple-muted">
        <Loader2 size={15} className="animate-spin" /> Finding {mode} routes…
      </div>
    );
  }
  const variants = data?.[mode]?.variants ?? [];
  if (variants.length === 0) {
    return (
      <p className="p-4 text-sm text-ripple-muted">
        No {mode === "walk" ? "walking" : "cycling"} route found for these
        stops.
      </p>
    );
  }
  const sel = Math.min(selected, variants.length - 1);

  // The user asked for a flavour we couldn't produce a distinct route for —
  // say so, rather than silently handing back the fastest.
  const preferMissing =
    preferredKind != null &&
    preferredKind !== "fastest" &&
    !variants.some(
      (v) => v.kind === preferredKind || v.also?.includes(preferredKind),
    );
  const preferLabel = preferredKind ? KIND_META[preferredKind].label : "";

  return (
    <div className="flex flex-col gap-3 p-3">
      {data && (
        <AdvisoryStrip
          advisory={
            mode === "cycle" && data.cycleAdvisory
              ? data.cycleAdvisory
              : data.advisory
          }
          area={data.weather?.area}
        />
      )}

      {preferMissing && (
        <div className="rounded-md bg-ripple-muted/10 px-3 py-2 text-xs text-ripple-muted">
          No distinct <span className="font-medium">{preferLabel}</span> route
          stands out for this trip — showing the fastest. Your preference still
          applies whenever a {preferLabel.toLowerCase()} path is worthwhile.
        </div>
      )}

      <h3 className="eyebrow -mb-1 text-ripple-muted">
        {variants.length === 1
          ? "Your route"
          : `${variants.length} ways to ${mode}`}
      </h3>

      {variants.map((v, i) => {
        const isSel = i === sel;
        const isExp = i === expandedIdx;
        return (
          <div
            key={v.kind}
            className={cn(
              "overflow-hidden rounded-lg border transition-colors",
              isSel
                ? "border-brand shadow-[var(--shadow-card)]"
                : "border-[var(--border)]",
            )}
          >
            <button
              onClick={() => {
                onSelect(i);
                setExpandedIdx((e) => (e === i ? null : i));
              }}
              aria-expanded={isExp}
              className={cn(
                "flex w-full flex-col gap-2 p-3 text-left",
                isSel ? "bg-brand/5" : "hover:bg-ripple-muted/5",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-[24px] font-bold leading-none tracking-tight">
                  {fmtDuration(v.durationS)}
                </span>
                {/* Distance is the trip's physical reality for walk/cycle, so
                    it pairs with the time hero. Calories + CO₂ demote into the
                    expanded detail (named by the footer row below). */}
                <span className="data-voice text-sm font-semibold text-ripple-muted">
                  {fmtDistance(v.distanceM)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <KindTag kind={v.kind} />
                {v.also?.map((k) => <KindTag key={k} kind={k} />)}
              </div>
              {v.callout && (
                // §12a Tier-1 exposure callout — one line, only when actionable.
                <div
                  className={cn(
                    "flex items-start gap-1 text-xs font-medium",
                    v.callout.level === "warning"
                      ? "text-warning"
                      : "text-brand",
                  )}
                >
                  {v.callout.level === "warning" ? (
                    <Umbrella size={12} className="mt-0.5 shrink-0" />
                  ) : (
                    <Sun size={12} className="mt-0.5 shrink-0" />
                  )}
                  {v.callout.message}
                </div>
              )}

              {/* Style-1 expand cue: names the secondary info that opens on tap.
                  The whole header is the toggle; the chevron flips when open. */}
              <div
                className={cn(
                  "-mx-3 -mb-3 mt-0.5 flex items-center justify-between border-t border-[var(--border)] px-3 py-2 font-mono text-[11px] text-ripple-muted",
                  isExp && "bg-ripple-muted/5",
                )}
              >
                <span>Calories, carbon &amp; terrain</span>
                <ChevronDown
                  size={14}
                  className={cn("transition-transform", isExp && "rotate-180")}
                />
              </div>
            </button>

            {isExp && (
              <div className="flex flex-col gap-2.5 p-3 pt-2.5">
                {/* Demoted benefit stats — the payoff for choosing to move,
                    now secondary to time + distance on the collapsed card. */}
                <div className="data-voice flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ripple-muted">
                  <span>
                    <Flame size={11} className="inline -translate-y-px" /> ~
                    {v.kcal} kcal
                  </span>
                  {data && (
                    <span>
                      <Leaf
                        size={11}
                        className="inline -translate-y-px text-ok"
                      />{" "}
                      saves {(data.co2SavedGrams / 1000).toFixed(2)} kg CO₂
                    </span>
                  )}
                </div>
                <MetricBar
                  label="Park connectors & cycling paths"
                  pct={v.pcnPct}
                  color="var(--gold)"
                />
                {v.shelterPct != null && (
                  <MetricBar
                    label="Sheltered walkways"
                    pct={v.shelterPct}
                    color="var(--brand)"
                  />
                )}
                <p
                  className={cn(
                    "text-xs",
                    v.comfort.tone === "warning"
                      ? "font-medium text-warning"
                      : "text-ripple-muted",
                  )}
                >
                  {v.comfort.label}
                </p>

                {mode === "walk" && v.distanceM > LONG_WALK_M && (
                  <div className="inline-flex items-center gap-1 self-start rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                    <TriangleAlert size={12} /> {fmtDistance(v.distanceM)} is a
                    long walk — consider transit.
                  </div>
                )}

                <Button
                  variant="accent"
                  className="w-full"
                  onClick={() => onStartJourney(v)}
                >
                  <Navigation size={16} /> Start journey
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {mode === "walk" && liveBoardStopCode && (
        <LiveArrivals busStopCode={liveBoardStopCode} />
      )}

      <p className="px-1 text-[11px] leading-relaxed text-ripple-muted">
        Routes by OneMap · park-connector coverage from NParks & LTA open data ·
        shelter coverage from OpenStreetMap covered walkways · calories are an
        estimate.
      </p>
    </div>
  );
}
