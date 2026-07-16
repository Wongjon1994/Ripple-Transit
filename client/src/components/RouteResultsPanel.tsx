import { Fragment, useState } from "react";
import {
  Footprints,
  TrainFront,
  Bus,
  Bike,
  Check,
  ChevronDown,
  ArrowRight,
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
import { LiveArrivals } from "./LiveArrivals.js";
import { TaxiCard } from "./TaxiCard.js";
import { Button, Card } from "./ui.js";
import type { TaxiEstimate } from "@shared/types.js";

function legColor(leg: RouteLeg): string {
  if (leg.type === "walk") return "#22c55e";
  if (leg.type === "cycle") return "#0ea5e9";
  if (leg.type === "bus") return "#3b82f6";
  return lineColor(leg.lineCode);
}

function legTitle(leg: RouteLeg): string {
  if (leg.type === "walk" || leg.type === "cycle") {
    const verb = leg.type === "walk" ? "Walk" : "Cycle";
    const to =
      cleanName(leg.toName) ?? leg.endBusStop ?? leg.endStation ?? null;
    return to ? `${verb} to ${to}` : verb;
  }
  if (leg.type === "mrt")
    return `${leg.startStation ?? "Board"} → ${leg.endStation ?? "Alight"}`;
  return `Bus ${leg.busNo ?? ""} → ${leg.endBusStop ?? "stop"}`;
}

/**
 * One leg of the journey as a stepper row: coloured dot + connecting spine,
 * so the whole route reads as one path instead of a stack of cards.
 */
function LegStep({ leg, isLast }: { leg: RouteLeg; isLast: boolean }) {
  const color = legColor(leg);
  const Icon =
    leg.type === "walk"
      ? Footprints
      : leg.type === "cycle"
        ? Bike
        : leg.type === "bus"
          ? Bus
          : TrainFront;
  const f = leg.busLegFeasibility;

  return (
    <div className="relative flex gap-3 pb-4 last:pb-0">
      {!isLast && (
        <span
          aria-hidden
          className="absolute bottom-0 left-[15px] top-8 w-[3px] -translate-x-1/2 rounded-full"
          style={{ background: `${color}59` }}
        />
      )}
      <span
        className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
        style={{ background: color }}
      >
        <Icon size={15} />
      </span>

      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold leading-snug text-[var(--fg)]">
            {legTitle(leg)}
            {leg.type === "mrt" && leg.lineCode && (
              <span
                className="ml-1.5 inline-block translate-y-[-1px] rounded px-1 py-px align-middle font-mono text-[10px] font-bold text-white"
                style={{ background: lineColor(leg.lineCode) }}
              >
                {leg.lineCode}
              </span>
            )}
          </span>
          <span className="data-voice shrink-0 whitespace-nowrap text-xs text-ripple-muted">
            {fmtDuration(leg.duration)} · {fmtDistance(leg.distance)}
            {leg.type === "mrt" && leg.numStops ? ` · ${leg.numStops} stops` : ""}
          </span>
        </div>

        {leg.type === "bus" && leg.startBusStop && (
          <div className="mt-0.5 text-xs text-ripple-muted">
            Board{" "}
            <span className="font-medium text-[var(--fg)]">
              {leg.startBusStop}
            </span>
            {leg.busStopCode ? (
              <span className="data-voice"> · {leg.busStopCode}</span>
            ) : null}
          </div>
        )}

        {leg.type === "mrt" && leg.exitName && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1 rounded-md bg-mrt/10 px-2 py-0.5 text-xs font-medium text-mrt">
              <DoorOpen size={12} /> {leg.exitName}
              {leg.exitDistanceM != null &&
                ` · ${fmtDistance(leg.exitDistanceM)}`}
            </span>
            {leg.exitAlternatives && leg.exitAlternatives.length > 0 && (
              <span className="text-xs text-ripple-muted">
                or {leg.exitAlternatives.map((e) => e.name).join(", ")}
              </span>
            )}
          </div>
        )}

        {leg.type === "bus" && leg.trafficAlert && (
          <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
            <TriangleAlert size={12} /> {leg.trafficAlert} — allow extra time
          </div>
        )}

        {f && <BusFeasibility leg={leg} f={f} />}
      </div>
    </div>
  );
}

/** Feasibility callout + re-route: pick an alternative to swap the active bus. */
function BusFeasibility({ leg, f }: { leg: RouteLeg; f: BusLegFeasibility }) {
  const [showAlts, setShowAlts] = useState(false);
  const [showArrivals, setShowArrivals] = useState(false);
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

  // Time you'd spend waiting at the stop after walking there (the positive
  // buffer). Shown as schedule detail — the coloured callout covers the risk.
  const waitMin = Math.max(0, active.buffer);

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

      {/* A comfortable catch collapses to a one-line pill; the verbose coloured
          callout only appears for tight/miss/unknown, where it earns its space. */}
      {active.status === "ok" ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-2.5 py-0.5 text-xs font-semibold text-ok">
          <Check size={12} strokeWidth={2.75} /> OK · {active.buffer} min buffer
        </span>
      ) : (
        <FeasibilityCallout status={active.status} buffer={active.buffer} />
      )}
      {active.eta && (
        <div className="data-voice mt-1.5 text-xs text-ripple-muted">
          {f.enRoute && f.arriveAtStopMs
            ? // Mid-journey boarding: timed against your projected arrival.
              `You reach this stop ~${fmtTime(new Date(f.arriveAtStopMs).toISOString())} · bus at ${fmtTime(active.eta)}`
            : `Bus at ${fmtTime(active.eta)} · ~${f.walkMinutes} min walk`}
          {waitMin > 0 && ` + ~${waitMin} min wait`}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {leg.busStopCode && (
          <button
            onClick={() => setShowArrivals((s) => !s)}
            aria-expanded={showArrivals}
            className="text-xs font-semibold text-brand hover:underline"
          >
            {showArrivals ? "Hide live board" : "Live board"}
          </button>
        )}
        {alts.length > 0 && (
          <button
            onClick={() => setShowAlts((s) => !s)}
            aria-expanded={showAlts}
            className="text-xs font-semibold text-brand hover:underline"
          >
            {showAlts
              ? "Hide other buses"
              : `${alts.length} other bus${alts.length > 1 ? "es" : ""}`}
          </button>
        )}
      </div>

      {showArrivals && leg.busStopCode && (
        <LiveArrivals
          busStopCode={leg.busStopCode}
          highlightService={active.serviceNo}
        />
      )}

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
                  <span className="font-mono text-base font-bold leading-none">
                    Bus {alt.serviceNo}
                  </span>
                  <div className="data-voice mt-1 text-xs text-ripple-muted">
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
            ? "bg-brand/10 text-brand"
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
  stopLabels,
}: {
  itineraries: Itinerary[];
  selected: number;
  onSelect: (i: number) => void;
  onSave?: () => void;
  onStartJourney?: () => void;
  weather?: WeatherContext | null;
  carbon?: CarbonBaseline | null;
  taxi?: TaxiEstimate | null;
  /** Multi-stop destination labels, used for the via dividers in the stepper. */
  stopLabels?: string[];
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
        <h3 className="eyebrow mb-2 text-ripple-muted">
          {itineraries.length === 1
            ? "Your route"
            : `${itineraries.length} ways there`}
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
                  isSel
                    ? "border-brand shadow-[var(--shadow-card)]"
                    : "border-[var(--border)]",
                )}
              >
                {/* Summary row — tap to select/expand */}
                <button
                  onClick={() => onSelect(i)}
                  aria-expanded={isSel}
                  className={cn(
                    "flex w-full flex-col gap-1.5 p-3 text-left",
                    isSel ? "bg-brand/5" : "hover:bg-ripple-muted/5",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-serif text-[22px] font-bold leading-none tracking-tight">
                      {fmtDuration(it.duration)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {i === fastestIdx && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-gold">
                          <Zap size={11} /> Fastest
                        </span>
                      )}
                      {dev > 0 && (
                        <span className="data-voice text-xs text-ripple-muted">
                          +{dev} min
                        </span>
                      )}
                      {showReliableTag && i === mostReliableIdx && (
                        <span className="text-xs font-semibold text-brand">
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
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold text-white"
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
                    <span className="data-voice text-xs text-ripple-muted">
                      ${it.fare.toFixed(2)} ·{" "}
                      {it.transfers === 0
                        ? "direct"
                        : `${it.transfers} transfer${it.transfers > 1 ? "s" : ""}`}
                      {it.co2Grams != null && ` · ${fmtCo2(it.co2Grams)} CO₂`}
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

                    <div className="p-3 pt-3.5">
                      {it.legs.map((leg, k) => (
                        <Fragment key={k}>
                          {leg.viaStopIndex != null && (
                            <div className="relative z-[1] mb-3 flex items-center gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold/15 font-mono text-[10px] font-bold text-gold ring-1 ring-gold/40">
                                {leg.viaStopIndex}
                              </span>
                              <span className="min-w-0 truncate text-xs font-semibold">
                                {stopLabels?.[leg.viaStopIndex - 1] ??
                                  `Stop ${leg.viaStopIndex}`}
                              </span>
                            </div>
                          )}
                          <LegStep
                            leg={leg}
                            isLast={k === it.legs.length - 1}
                          />
                        </Fragment>
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
