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
} from "lucide-react";
import type {
  ActiveMode,
  ActiveRoutesResult,
  ActiveVariant,
  ActiveVariantKind,
} from "@shared/types.js";
import { fmtDuration, fmtDistance, cn } from "../lib/utils.js";
import { Button } from "./ui.js";

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
}: {
  mode: ActiveMode;
  data: ActiveRoutesResult | undefined;
  isLoading: boolean;
  selected: number;
  onSelect: (i: number) => void;
  onStartJourney: (variant: ActiveVariant) => void;
  /** Collapse all cards when this changes (i.e. on a new search). */
  collapseKey?: string;
}) {
  // §9: cards render Tier-1 only until tapped; selection (map) is separate.
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  useEffect(() => setExpandedIdx(null), [collapseKey, mode]);
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
  const ModeIcon = mode === "walk" ? Footprints : Bike;
  const sel = Math.min(selected, variants.length - 1);

  return (
    <div className="flex flex-col gap-3 p-3">
      {data && (
        <AdvisoryStrip advisory={data.advisory} area={data.weather?.area} />
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
              <div className="flex items-start justify-between gap-2">
                <div className="font-serif text-[24px] font-bold leading-none tracking-tight">
                  {fmtDuration(v.durationS)}
                </div>
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ background: mode === "walk" ? "#22c55e" : "#0ea5e9" }}
                >
                  <ModeIcon size={15} />
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <KindTag kind={v.kind} />
                {v.also?.map((k) => <KindTag key={k} kind={k} />)}
              </div>
              <div className="data-voice text-xs text-ripple-muted">
                {fmtDistance(v.distanceM)} ·{" "}
                <Flame size={11} className="inline -translate-y-px" /> ~{v.kcal}{" "}
                kcal
                {data && (
                  <>
                    {" · "}
                    <Leaf size={11} className="inline -translate-y-px text-ok" />{" "}
                    saves {(data.co2SavedGrams / 1000).toFixed(2)} kg CO₂
                  </>
                )}
              </div>
            </button>

            {isExp && (
              <div className="flex flex-col gap-2.5 border-t border-[var(--border)] p-3">
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

      <p className="px-1 text-[11px] leading-relaxed text-ripple-muted">
        Routes by OneMap · park-connector coverage from NParks & LTA open data ·
        shelter coverage from OpenStreetMap covered walkways · calories are an
        estimate.
      </p>
    </div>
  );
}
