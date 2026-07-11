import { useState } from "react";
import {
  Footprints,
  TrainFront,
  Bus,
  ChevronDown,
  ArrowRight,
  Clock,
  Wallet,
  Repeat,
} from "lucide-react";
import type { Itinerary, RouteLeg } from "@shared/types.js";
import { fmtDuration, fmtDistance, fmtTime, cn } from "../lib/utils.js";
import { FeasibilityBadge, feasibilityMessage } from "./FeasibilityBadge.js";
import { Button } from "./ui.js";

function LegIcon({ type }: { type: RouteLeg["type"] }) {
  const common = "shrink-0";
  if (type === "walk")
    return <Footprints size={16} className={cn(common, "text-walk")} />;
  if (type === "mrt")
    return <TrainFront size={16} className={cn(common, "text-mrt")} />;
  return <Bus size={16} className={cn(common, "text-bus")} />;
}

function LegRow({ leg, index }: { leg: RouteLeg; index: number }) {
  const [showAlts, setShowAlts] = useState(false);
  const f = leg.busLegFeasibility;

  return (
    <div className="flex gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
      <div className="flex flex-col items-center pt-0.5">
        <LegIcon type={leg.type} />
        <span className="mt-1 text-[10px] font-semibold text-ripple-muted">
          {index + 1}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        {/* Title line */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-[var(--fg)]">
            {leg.type === "walk" && `Walk · ${fmtDuration(leg.duration)}`}
            {leg.type === "mrt" &&
              `${leg.lineCode ? leg.lineCode + " " : ""}MRT · ${fmtDuration(leg.duration)}`}
            {leg.type === "bus" && `Bus ${leg.busNo ?? ""} · ${fmtDuration(leg.duration)}`}
          </span>
          <span className="text-xs text-ripple-muted">
            {fmtDistance(leg.distance)}
            {leg.type === "mrt" && leg.numStops
              ? ` · ${leg.numStops} stops`
              : ""}
          </span>
        </div>

        {/* Endpoints */}
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ripple-muted">
          <span className="truncate">
            {leg.startStation ?? leg.startBusStop ?? "Start"}
          </span>
          {(leg.endStation || leg.endBusStop) && (
            <>
              <ArrowRight size={11} className="shrink-0" />
              <span className="truncate">
                {leg.endStation ?? leg.endBusStop}
              </span>
            </>
          )}
          {leg.type === "mrt" && leg.lineName && (
            <span className="truncate">· {leg.lineName}</span>
          )}
        </div>

        {/* Bus feasibility */}
        {f && (
          <div className="mt-2 rounded-md bg-ripple-muted/5 p-2.5">
            <div className="flex items-center gap-2">
              <FeasibilityBadge status={f.status} buffer={f.buffer} />
              {f.eta && (
                <span className="text-xs text-ripple-muted">
                  ETA {fmtTime(f.eta)} · walk ~{f.walkMinutes} min
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs text-ripple-muted">
              {feasibilityMessage(f.status, f.buffer)}
            </p>

            {f.alternatives.length > 0 && (
              <div className="mt-2">
                <button
                  onClick={() => setShowAlts((s) => !s)}
                  className="flex items-center gap-1 text-xs font-semibold text-bus hover:underline"
                  aria-expanded={showAlts}
                >
                  <ChevronDown
                    size={13}
                    className={cn("transition-transform", showAlts && "rotate-180")}
                  />
                  {showAlts ? "Hide" : "Show"} {f.alternatives.length}{" "}
                  alternative{f.alternatives.length > 1 ? "s" : ""}
                </button>
                {showAlts && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {f.alternatives.map((alt, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <Bus size={13} className="text-bus" />
                          <span className="text-sm font-semibold">
                            {alt.serviceNo}
                          </span>
                          <span className="text-xs text-ripple-muted">
                            {fmtTime(alt.eta)}
                          </span>
                        </div>
                        <FeasibilityBadge
                          status={alt.feasibility}
                          buffer={alt.buffer}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryChip({
  icon: Icon,
  children,
}: {
  icon: typeof Clock;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <Icon size={14} className="text-ripple-muted" />
      {children}
    </span>
  );
}

export function RouteResultsPanel({
  itineraries,
  selected,
  onSelect,
  onSave,
}: {
  itineraries: Itinerary[];
  selected: number;
  onSelect: (i: number) => void;
  onSave?: () => void;
}) {
  if (itineraries.length === 0) return null;
  const active = itineraries[selected];

  return (
    <div className="flex flex-col">
      {/* Itinerary selector */}
      <div className="flex gap-2 overflow-x-auto p-3">
        {itineraries.map((it, i) => (
          <button
            key={i}
            onClick={() => onSelect(i)}
            className={cn(
              "flex shrink-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
              i === selected
                ? "border-ripple-fg bg-ripple-muted/10"
                : "border-[var(--border)] hover:bg-ripple-muted/5",
            )}
          >
            <span className="text-base font-semibold">
              {fmtDuration(it.duration)}
            </span>
            <span className="text-xs text-ripple-muted">
              ${it.fare.toFixed(2)} ·{" "}
              {it.transfers === 0
                ? "direct"
                : `${it.transfers} transfer${it.transfers > 1 ? "s" : ""}`}
            </span>
          </button>
        ))}
      </div>

      {/* Active itinerary summary */}
      <div className="flex items-center gap-4 border-y border-[var(--border)] bg-ripple-muted/5 px-4 py-2.5">
        <SummaryChip icon={Clock}>{fmtDuration(active.duration)}</SummaryChip>
        <SummaryChip icon={Wallet}>${active.fare.toFixed(2)}</SummaryChip>
        <SummaryChip icon={Repeat}>
          {active.transfers} transfer{active.transfers === 1 ? "" : "s"}
        </SummaryChip>
      </div>

      {/* Legs */}
      <div>
        {active.legs.map((leg, i) => (
          <LegRow key={i} leg={leg} index={i} />
        ))}
      </div>

      {onSave && (
        <div className="p-3">
          <Button variant="outline" className="w-full" onClick={onSave}>
            Save this route
          </Button>
        </div>
      )}
    </div>
  );
}
