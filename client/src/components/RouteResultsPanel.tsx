import { useState } from "react";
import {
  Footprints,
  TrainFront,
  Bus,
  ChevronDown,
  ArrowRight,
  BarChart3,
  DoorOpen,
  RotateCcw,
  ShieldCheck,
  CloudRain,
  Cloud,
  Sun,
  Zap,
  TriangleAlert,
  Leaf,
  Navigation,
  Bookmark,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Itinerary,
  RouteLeg,
  BusLegFeasibility,
  BusAlternative,
  WeatherContext,
  CarbonBaseline,
  RiskLevel,
} from "@shared/types.js";
import { RISK_COLORS, RISK_LABELS } from "@shared/types.js";
import { fmtDuration, fmtDistance, fmtTime, cn } from "../lib/utils.js";
import { lineColor, lineName } from "../lib/transit.js";
import { FeasibilityBadge, FeasibilityCallout } from "./FeasibilityBadge.js";
import { TaxiCard } from "./TaxiCard.js";
import { Button, Card } from "./ui.js";
import type { TaxiEstimate } from "@shared/types.js";

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

          {leg.type === "mrt" && leg.exitName && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1 rounded-md bg-mrt/10 px-2 py-0.5 text-xs font-medium text-mrt">
                <DoorOpen size={12} /> Alight and take {leg.exitName}
                {leg.exitDistanceM != null &&
                  ` · ${fmtDistance(leg.exitDistanceM)} to go`}
              </span>
              {leg.exitAlternatives && leg.exitAlternatives.length > 0 && (
                <span className="text-xs text-ripple-muted">
                  or {leg.exitAlternatives.map((e) => e.name).join(", ")}
                </span>
              )}
            </div>
          )}

          {leg.type === "walk" && cleanName(leg.toName) && (
            <div className="mt-1 flex items-center gap-1 text-xs text-ripple-muted">
              <ArrowRight size={10} className="shrink-0" />
              <span className="truncate">to {cleanName(leg.toName)}</span>
            </div>
          )}

          {leg.type === "bus" && leg.startBusStop && (
            <div className="mt-1 text-xs text-ripple-muted">
              Board at{" "}
              <span className="font-medium text-[var(--fg)]">
                {leg.startBusStop}
              </span>
              {leg.busStopCode ? ` · ${leg.busStopCode}` : ""}
            </div>
          )}

          {leg.type === "bus" && leg.trafficAlert && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
              <TriangleAlert size={12} /> {leg.trafficAlert} — allow extra time
            </div>
          )}

          {f && <BusFeasibility leg={leg} f={f} />}
        </div>
      </div>
    </Card>
  );
}

/** Feasibility callout + re-route: pick an alternative to swap the active bus. */
function BusFeasibility({ leg, f }: { leg: RouteLeg; f: BusLegFeasibility }) {
  const [showAlts, setShowAlts] = useState(false);
  const [chosen, setChosen] = useState<BusAlternative | null>(null);

  const active = chosen
    ? {
        serviceNo: chosen.serviceNo,
        status: chosen.feasibility,
        buffer: chosen.buffer,
        eta: chosen.eta,
      }
    : {
        serviceNo: leg.busNo,
        status: f.status,
        buffer: f.buffer,
        eta: f.eta,
      };

  // Show every alternative except the one currently active.
  const alts = f.alternatives.filter(
    (a) => !(a.serviceNo === active.serviceNo && a.eta === active.eta),
  );

  return (
    <div className="mt-2.5">
      {chosen && (
        <div className="mb-1.5 flex items-center justify-between gap-2 rounded-md bg-bus/10 px-2.5 py-1.5 text-xs text-bus">
          <span className="font-medium">Taking Bus {chosen.serviceNo} instead</span>
          <button
            onClick={() => setChosen(null)}
            className="inline-flex items-center gap-1 font-medium hover:underline"
          >
            <RotateCcw size={12} /> Undo
          </button>
        </div>
      )}

      <FeasibilityCallout status={active.status} buffer={active.buffer} />
      {active.eta && (
        <div className="mt-1.5 text-xs text-ripple-muted">
          Depart {fmtTime(active.eta)} · walk ~{f.walkMinutes} min
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
        {alts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAlts((s) => !s)}
            aria-expanded={showAlts}
          >
            <ChevronDown
              size={14}
              className={cn("transition-transform", showAlts && "rotate-180")}
            />
            {showAlts ? "Hide" : "Show"} {alts.length} other bus
            {alts.length > 1 ? "es" : ""}
          </Button>
        )}
      </div>

      {showAlts && alts.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-2 text-xs text-ripple-muted">
            Interchangeable buses for this leg, by arrival — tap to switch
          </p>
          <div className="flex flex-col gap-2">
            {alts.map((alt, i) => (
              <Card
                key={i}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <span className="text-base font-bold leading-none">
                    Bus {alt.serviceNo}
                  </span>
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
                  onClick={() => {
                    setChosen(alt);
                    setShowAlts(false);
                    toast.success(
                      `Switched to Bus ${alt.serviceNo} — ETA ${fmtTime(alt.eta)}.`,
                    );
                  }}
                >
                  Take this bus <ArrowRight size={14} />
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Drop OTP's generic endpoint names ("Origin"/"Destination") from display. */
function cleanName(n?: string): string | null {
  if (!n) return null;
  return /^(origin|destination|start|end)$/i.test(n.trim()) ? null : n;
}

interface ModeChip {
  label: string;
  color: string;
  kind: "bus" | "mrt";
}

/** The transit legs of an itinerary as chips (the "path": e.g. 186 → CC). */
function journeyModes(it: Itinerary): ModeChip[] {
  return it.legs
    .filter((l) => l.type !== "walk")
    .map((l) =>
      l.type === "bus"
        ? { label: l.busNo ?? "Bus", color: "#3b82f6", kind: "bus" as const }
        : {
            label: l.lineCode ?? "MRT",
            color: lineColor(l.lineCode),
            kind: "mrt" as const,
          },
    );
}

function RiskPill({ level }: { level: RiskLevel }) {
  const color = RISK_COLORS[level];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color, background: `${color}1a` }}
    >
      <ShieldCheck size={11} />
      {RISK_LABELS[level]}
    </span>
  );
}

/**
 * One compact weather line. Plain/muted when conditions are unremarkable;
 * coloured and prominent only when there's an advisory (rain / heat).
 */
function WeatherStrip({ weather }: { weather: WeatherContext }) {
  const Icon = weather.wet
    ? CloudRain
    : /cloud/i.test(weather.forecast)
      ? Cloud
      : Sun;
  const adv = weather.advisory;
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-2 text-xs",
        adv?.level === "warning"
          ? "bg-warning/10 text-warning"
          : adv
            ? "bg-bus/10 text-bus"
            : "text-ripple-muted",
      )}
    >
      <Icon size={14} className="shrink-0" />
      <span className={cn("font-medium", !adv && "text-[var(--fg)]")}>
        {weather.temperature != null ? `${Math.round(weather.temperature)}° · ` : ""}
        {weather.forecast}
      </span>
      {adv ? (
        <span className="truncate">— {adv.message}</span>
      ) : (
        <span className="truncate text-ripple-muted">near {weather.area}</span>
      )}
    </div>
  );
}

function fmtCo2(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(1)} kg` : `${Math.round(grams)} g`;
}

/** Carbon one-liner that expands to a route-vs-taxi-vs-car breakdown on tap. */
function CarbonInline({
  routeGrams,
  carbon,
}: {
  routeGrams: number;
  carbon: CarbonBaseline;
}) {
  const [open, setOpen] = useState(false);
  const saved = Math.max(0, carbon.taxiGrams - routeGrams);
  const max = Math.max(routeGrams, carbon.taxiGrams, carbon.carGrams, 1);
  const rows: [string, number, string][] = [
    ["This route", routeGrams, "#10b981"],
    ["Taxi", carbon.taxiGrams, "#6b7280"],
    ["Car", carbon.carGrams, "#9ca3af"],
  ];
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-xs"
        aria-expanded={open}
      >
        <Leaf size={13} className="shrink-0 text-ok" />
        <span className="font-medium text-ok">{fmtCo2(routeGrams)} CO₂</span>
        {saved > 0 && (
          <span className="text-ripple-muted">
            · save {(saved / 1000).toFixed(2)} kg vs taxi
          </span>
        )}
        <ChevronDown
          size={12}
          className={cn(
            "ml-auto text-ripple-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          {rows.map(([label, grams, color]) => (
            <div key={label}>
              <div className="flex justify-between text-xs">
                <span className="text-ripple-muted">{label}</span>
                <span className="font-medium">{fmtCo2(grams)}</span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-ripple-muted/15">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(3, (grams / max) * 100)}%`,
                    background: color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RouteResultsPanel({
  itineraries,
  selected,
  onSelect,
  onSave,
  onStartJourney,
  weather,
  carbon,
  taxi,
}: {
  itineraries: Itinerary[];
  selected: number;
  onSelect: (i: number) => void;
  onSave?: () => void;
  onStartJourney?: () => void;
  weather?: WeatherContext | null;
  carbon?: CarbonBaseline | null;
  taxi?: TaxiEstimate | null;
}) {
  if (itineraries.length === 0) return null;
  const fastest = Math.min(...itineraries.map((it) => it.duration));

  // Decision aids: which option is quickest vs most reliable.
  const riskScore = (it: Itinerary) => it.risk?.score ?? 0;
  const fastestIdx = itineraries.findIndex((it) => it.duration === fastest);
  const mostReliableIdx = itineraries.reduce(
    (best, it, i) => (riskScore(it) < riskScore(itineraries[best]) ? i : best),
    0,
  );
  const showReliableTag =
    itineraries.length > 1 &&
    mostReliableIdx !== fastestIdx &&
    riskScore(itineraries[mostReliableIdx]) < riskScore(itineraries[fastestIdx]);

  return (
    <div className="flex flex-col">
      {weather && <WeatherStrip weather={weather} />}

      <div className="p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ripple-muted">
          {itineraries.length === 1
            ? "Your route"
            : `${itineraries.length} ways to your destination`}
        </h3>
        <div className="flex flex-col gap-2">
          {itineraries.map((it, i) => {
            const dev = Math.round((it.duration - fastest) / 60);
            const modes = journeyModes(it);
            const isSel = i === selected;
            return (
              <div
                key={i}
                className={cn(
                  "overflow-hidden rounded-lg border transition-colors",
                  isSel ? "border-bus" : "border-[var(--border)]",
                )}
              >
                {/* Summary row — tap to select/expand */}
                <button
                  onClick={() => onSelect(i)}
                  aria-expanded={isSel}
                  className={cn(
                    "flex w-full flex-col gap-1.5 p-3 text-left",
                    isSel ? "bg-bus/5" : "hover:bg-ripple-muted/5",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold">
                      {fmtDuration(it.duration)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {i === fastestIdx && (
                        <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-ok">
                          <Zap size={12} /> Fastest
                        </span>
                      )}
                      {dev > 0 && (
                        <span className="text-xs text-ripple-muted">+{dev} min</span>
                      )}
                      {showReliableTag && i === mostReliableIdx && (
                        <span className="text-xs font-semibold text-bus">
                          Most reliable
                        </span>
                      )}
                      <ChevronDown
                        size={15}
                        className={cn(
                          "text-ripple-muted transition-transform",
                          isSel && "rotate-180",
                        )}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {modes.map((m, j) => (
                      <span key={j} className="inline-flex items-center gap-1">
                        {j > 0 && (
                          <ArrowRight size={10} className="text-ripple-muted" />
                        )}
                        <span
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
                          style={{ background: m.color }}
                        >
                          {m.kind === "bus" ? (
                            <Bus size={11} />
                          ) : (
                            <TrainFront size={11} />
                          )}
                          {m.label}
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ripple-muted">
                      ${it.fare.toFixed(2)} ·{" "}
                      {it.transfers === 0
                        ? "direct"
                        : `${it.transfers} transfer${it.transfers > 1 ? "s" : ""}`}
                    </span>
                    {it.risk && <RiskPill level={it.risk.level} />}
                  </div>
                </button>

                {/* Details — only for the expanded option */}
                {isSel && (
                  <div className="border-t border-[var(--border)]">
                    {it.risk && it.risk.reasons.length > 0 && (
                      <div className="border-b border-[var(--border)] px-3 py-2 text-xs text-ripple-muted">
                        <span
                          className="font-medium"
                          style={{ color: RISK_COLORS[it.risk.level] }}
                        >
                          {RISK_LABELS[it.risk.level]}
                        </span>{" "}
                        · {it.risk.reasons.join(" · ")}
                      </div>
                    )}

                    {carbon && it.co2Grams != null && (
                      <div className="border-b border-[var(--border)] px-3 py-2.5">
                        <CarbonInline routeGrams={it.co2Grams} carbon={carbon} />
                      </div>
                    )}

                    <div className="flex flex-col gap-2 p-3">
                      {it.legs.map((leg, k) => (
                        <LegCard key={k} leg={leg} />
                      ))}
                    </div>

                    {(onStartJourney || onSave) && (
                      <div className="flex gap-2 px-3 pb-3">
                        {onStartJourney && (
                          <Button
                            variant="accent"
                            className="flex-1"
                            onClick={onStartJourney}
                          >
                            <Navigation size={16} /> Start journey
                          </Button>
                        )}
                        {onSave && (
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Save route"
                            onClick={onSave}
                          >
                            <Bookmark size={16} />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {taxi && <TaxiCard taxi={taxi} />}
        </div>
      </div>
    </div>
  );
}
