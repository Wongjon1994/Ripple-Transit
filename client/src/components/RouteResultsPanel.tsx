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
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import type { Itinerary, RouteLeg } from "@shared/types.js";
import { fmtDuration, fmtDistance, fmtTime, cn } from "../lib/utils.js";
import { lineColor, lineName } from "../lib/transit.js";
import { FeasibilityBadge, FeasibilityCallout } from "./FeasibilityBadge.js";
import { Button, Card } from "./ui.js";

function LegIconCircle({ leg }: { leg: RouteLeg }) {
  const bg =
    leg.type === "walk"
      ? "#22c55e"
      : leg.type === "bus"
        ? "#3b82f6"
        : lineColor(leg.lineCode);
  const Icon =
    leg.type === "walk" ? Footprints : leg.type === "bus" ? Bus : TrainFront;
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
      style={{ background: bg }}
    >
      <Icon size={17} />
    </span>
  );
}

function legTitle(leg: RouteLeg): string {
  if (leg.type === "walk")
    return `${leg.startBusStop ?? leg.startStation ?? "Walk"} → ${leg.endBusStop ?? leg.endStation ?? "destination"}`;
  if (leg.type === "mrt")
    return `${leg.startStation ?? "Board"} → ${leg.endStation ?? "Alight"}`;
  return `Bus ${leg.busNo ?? ""} → ${leg.endBusStop ?? "stop"}`;
}

function LegCard({ leg }: { leg: RouteLeg }) {
  const [showAlts, setShowAlts] = useState(false);
  const f = leg.busLegFeasibility;

  return (
    <Card className="p-4">
      <div className="flex gap-3">
        <LegIconCircle leg={leg} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-semibold leading-snug text-[var(--fg)]">
              {leg.type === "walk" ? "Walk" : legTitle(leg)}
            </span>
            {leg.type === "mrt" && leg.lineCode && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
                style={{ background: lineColor(leg.lineCode) }}
              >
                {leg.lineCode}
              </span>
            )}
          </div>

          <div className="mt-0.5 text-xs text-ripple-muted">
            {fmtDuration(leg.duration)} · {fmtDistance(leg.distance)}
            {leg.type === "mrt" && leg.numStops ? ` · ${leg.numStops} stops` : ""}
          </div>

          {leg.type === "mrt" && (
            <div className="mt-1 text-xs text-ripple-muted">
              {lineName(leg.lineCode)}
              {leg.startStation && leg.endStation ? (
                <span className="inline-flex items-center gap-1">
                  {" · "}
                  {leg.startStation}
                  <ArrowRight size={10} />
                  {leg.endStation}
                </span>
              ) : null}
            </div>
          )}

          {leg.type === "walk" && (leg.startBusStop || leg.endStation) && (
            <div className="mt-1 flex items-center gap-1 text-xs text-ripple-muted">
              <span className="truncate">{leg.startStation ?? "Start"}</span>
              <ArrowRight size={10} className="shrink-0" />
              <span className="truncate">{leg.endStation ?? "next stop"}</span>
            </div>
          )}

          {f && (
            <div className="mt-2.5">
              <FeasibilityCallout status={f.status} buffer={f.buffer} />
              {f.eta && (
                <div className="mt-1.5 text-xs text-ripple-muted">
                  Depart {fmtTime(f.eta)} · walk ~{f.walkMinutes} min
                </div>
              )}

              <div className="mt-2 flex flex-wrap gap-2">
                {leg.busStopCode && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      toast.info(
                        `Live arrivals at stop ${leg.busStopCode} — full board coming soon.`,
                      )
                    }
                  >
                    <BarChart3 size={14} /> View arrivals
                  </Button>
                )}
                {f.alternatives.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAlts((s) => !s)}
                    aria-expanded={showAlts}
                  >
                    <ChevronDown
                      size={14}
                      className={cn(
                        "transition-transform",
                        showAlts && "rotate-180",
                      )}
                    />
                    {showAlts ? "Hide" : "Show"} {f.alternatives.length}{" "}
                    alternative{f.alternatives.length > 1 ? "s" : ""}
                  </Button>
                )}
              </div>

              {showAlts && f.alternatives.length > 0 && (
                <div className="mt-2.5">
                  <p className="mb-2 text-xs text-ripple-muted">
                    Other buses at this stop that might work better
                  </p>
                  <div className="flex flex-col gap-2">
                    {f.alternatives.map((alt, i) => (
                      <Card
                        key={i}
                        className="flex items-center justify-between gap-3 p-3"
                      >
                        <div className="min-w-0">
                          <div className="text-base font-bold leading-none">
                            Bus {alt.serviceNo}
                          </div>
                          <div className="mt-1 text-xs text-ripple-muted">
                            ETA {fmtTime(alt.eta)}
                          </div>
                          <div className="mt-1.5">
                            <FeasibilityBadge
                              status={alt.feasibility}
                              buffer={alt.buffer}
                            />
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 whitespace-nowrap"
                          onClick={() =>
                            toast.success(
                              `Bus ${alt.serviceNo} selected — arriving ${fmtTime(alt.eta)}.`,
                            )
                          }
                        >
                          Take this bus <ArrowRight size={14} />
                        </Button>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
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
      <div className="flex gap-2 overflow-x-auto p-3">
        {itineraries.map((it, i) => (
          <button
            key={i}
            onClick={() => onSelect(i)}
            className={cn(
              "flex shrink-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
              i === selected
                ? "border-bus bg-bus/5"
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

      <div className="flex items-center gap-4 border-y border-[var(--border)] bg-ripple-muted/5 px-4 py-2.5">
        <SummaryChip icon={Clock}>{fmtDuration(active.duration)}</SummaryChip>
        <SummaryChip icon={Wallet}>${active.fare.toFixed(2)}</SummaryChip>
        <SummaryChip icon={Repeat}>
          {active.transfers} transfer{active.transfers === 1 ? "" : "s"}
        </SummaryChip>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {active.legs.map((leg, i) => (
          <LegCard key={i} leg={leg} />
        ))}
      </div>

      {onSave && (
        <div className="px-3 pb-3">
          <Button variant="outline" className="w-full" onClick={onSave}>
            Save this route
          </Button>
        </div>
      )}
    </div>
  );
}
