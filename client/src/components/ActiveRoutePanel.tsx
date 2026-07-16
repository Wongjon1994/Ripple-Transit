import {
  Footprints,
  Bike,
  Navigation,
  Loader2,
  CloudRain,
  Sun,
  ThermometerSun,
  Leaf,
  Flame,
  TriangleAlert,
} from "lucide-react";
import type {
  ActiveRoute,
  ActiveRoutesResult,
  ActiveMode,
} from "@shared/types.js";
import { fmtDuration, fmtDistance, cn } from "../lib/utils.js";
import { Button } from "./ui.js";

const LONG_WALK_M = 8000;

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

function CoverageBar({ route }: { route: ActiveRoute }) {
  const { pct, label, tone } = route.coverage;
  const color =
    tone === "ok" ? "var(--gold)" : tone === "warning" ? "#f59e0b" : "#9ca3af";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow text-ripple-muted">
          Park connectors & cycling paths
        </span>
        <span className="data-voice text-xs font-semibold text-[var(--fg)]">
          {pct}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ripple-muted/15">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(2, pct)}%`, background: color }}
        />
      </div>
      <p
        className={cn(
          "mt-1.5 text-xs",
          tone === "warning" ? "font-medium text-warning" : "text-ripple-muted",
        )}
      >
        {label}
      </p>
    </div>
  );
}

/**
 * Walk / Cycle tab content: one OneMap path per mode, scored for comfort
 * against the PCN + cycling-path network, with a live weather call-out.
 */
export function ActiveRoutePanel({
  mode,
  data,
  isLoading,
  onStartJourney,
}: {
  mode: ActiveMode;
  data: ActiveRoutesResult | undefined;
  isLoading: boolean;
  onStartJourney: (route: ActiveRoute) => void;
}) {
  const Icon = mode === "walk" ? Footprints : Bike;
  const verb = mode === "walk" ? "Walking" : "Cycling";

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-ripple-muted">
        <Loader2 size={15} className="animate-spin" /> Finding a {mode} route…
      </div>
    );
  }
  const route = data?.[mode];
  if (!route) {
    return (
      <p className="p-4 text-sm text-ripple-muted">
        No {mode === "walk" ? "walking" : "cycling"} route found for this pair.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {data && <AdvisoryStrip advisory={data.advisory} area={data.weather?.area} />}

      <div className="rounded-lg border border-brand bg-brand/5 p-3 shadow-[var(--shadow-card)]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-serif text-[26px] font-bold leading-none tracking-tight">
              {fmtDuration(route.durationS)}
            </div>
            <div className="data-voice mt-1.5 text-xs text-ripple-muted">
              {fmtDistance(route.distanceM)} ·{" "}
              <Flame size={11} className="inline -translate-y-px" /> ~
              {route.kcal} kcal ·{" "}
              <Leaf size={11} className="inline -translate-y-px text-ok" />{" "}
              saves {(route.co2SavedGrams / 1000).toFixed(2)} kg CO₂
            </div>
          </div>
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
            style={{
              background: mode === "walk" ? "#22c55e" : "#0ea5e9",
            }}
          >
            <Icon size={17} />
          </span>
        </div>

        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <CoverageBar route={route} />
        </div>

        {mode === "walk" && route.distanceM > LONG_WALK_M && (
          <div className="mt-2.5 inline-flex items-center gap-1 rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
            <TriangleAlert size={12} /> {verb}{" "}
            {fmtDistance(route.distanceM)} is a long one — consider transit.
          </div>
        )}

        <Button
          variant="accent"
          className="mt-3 w-full"
          onClick={() => onStartJourney(route)}
        >
          <Navigation size={16} /> Start journey
        </Button>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-ripple-muted">
        Route by OneMap · comfort scored against NParks Park Connector Loop and
        LTA Cycling Path Network · calories are an estimate.
      </p>
    </div>
  );
}
