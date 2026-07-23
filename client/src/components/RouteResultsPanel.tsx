import { Fragment, useEffect, useState } from "react";
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
  Users,
  Navigation,
  Bookmark,
  CalendarClock,
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
import { trpc } from "../lib/trpc.js";
import { FeasibilityBadge, FeasibilityCallout } from "./FeasibilityBadge.js";
import { StatusBadge, riskTier } from "./StatusBadge.js";
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
function LegStep({
  leg,
  isLast,
  prevEndMs,
}: {
  leg: RouteLeg;
  isLast: boolean;
  /** Scheduled arrival at this leg's start (previous leg's end), for waits. */
  prevEndMs?: number;
}) {
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

  // Scheduled platform wait for an MRT leg: gap between reaching the station
  // (previous leg's scheduled end) and the train's scheduled departure. OTP's
  // timetable is the source of truth; live arrivals aren't published for rail.
  const mrtWaitMin =
    leg.type === "mrt" && leg.startTimeMs != null && prevEndMs != null
      ? Math.max(0, Math.round((leg.startTimeMs - prevEndMs) / 60000))
      : null;

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
          <span className="min-w-0 text-sm font-semibold leading-snug text-[var(--fg)]">
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
          </span>
        </div>
        {/* Stops counter between transit stops (MRT + bus) */}
        {(leg.type === "mrt" || leg.type === "bus") && leg.numStops ? (
          <div className="data-voice mt-0.5 text-[11px] font-medium text-ripple-muted">
            {leg.numStops} stop{leg.numStops > 1 ? "s" : ""}
          </div>
        ) : null}

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

        {leg.type === "mrt" && leg.startTimeMs != null && (
          <div className="data-voice mt-0.5 text-xs text-ripple-muted">
            Departs {fmtTime(new Date(leg.startTimeMs).toISOString())}
            {mrtWaitMin != null && mrtWaitMin > 0
              ? ` · ~${mrtWaitMin} min wait`
              : ""}{" "}
            · scheduled
          </div>
        )}

        {leg.type === "mrt" && leg.exitName && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* Wayfinding, not a warning (§5): neutral cyan, never the red
                MRT-mode colour it used to borrow. */}
            <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
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

        {leg.type === "mrt" && (leg.crowd === "h" || leg.crowd === "m") && (
          <div
            className={cn(
              "mt-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
              leg.crowd === "h"
                ? "bg-warning/10 text-warning"
                : "bg-ripple-muted/10 text-ripple-muted",
            )}
          >
            <Users size={12} />
            {leg.crowd === "h" ? "Crowded platform" : "Moderate crowd"}
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

  // Trip scheduled beyond LTA's live horizon — show the timetable time, clearly
  // flagged, rather than a misleading live arrival from now. Live board is still
  // offered (it becomes accurate closer to departure).
  if (f.scheduled) {
    return (
      <div className="mt-2.5">
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full bg-mrt/10 px-2.5 py-0.5 text-xs font-semibold text-mrt">
          <CalendarClock size={12} />
          {f.eta ? `Departs ~${fmtTime(f.eta)}` : "Scheduled"} · scheduled
        </span>
        <div className="mt-1 text-xs text-ripple-muted">
          Timetable estimate — live arrivals appear within ~45 min of departure.
        </div>
        {leg.busStopCode && (
          <button
            onClick={() => setShowArrivals((s) => !s)}
            aria-expanded={showArrivals}
            className="mt-1.5 text-xs font-semibold text-brand hover:underline"
          >
            {showArrivals ? "Hide live board" : "Live board"}
          </button>
        )}
        {showArrivals && leg.busStopCode && (
          <div className="mt-2">
            <LiveArrivals
              busStopCode={leg.busStopCode}
              highlightService={leg.busNo}
            />
          </div>
        )}
      </div>
    );
  }

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

      {/* §9: a comfortable catch is ONE line — pill + bus time. The verbose
          coloured callout (plus its schedule detail) only appears for
          tight/miss/unknown, where the extra guidance earns its space. */}
      {active.status === "ok" ? (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full bg-ok/10 px-2.5 py-0.5 text-xs font-semibold text-ok">
          <Check size={12} strokeWidth={2.75} /> OK · {active.buffer} min buffer
          {active.eta && (
            <span className="data-voice font-medium opacity-90">
              {f.enRoute && f.arriveAtStopMs
                ? ` · reach ~${fmtTime(new Date(f.arriveAtStopMs).toISOString())} · bus ${fmtTime(active.eta)}`
                : ` · bus ${fmtTime(active.eta)}`}
            </span>
          )}
        </span>
      ) : (
        <>
          <FeasibilityCallout status={active.status} buffer={active.buffer} />
          {active.eta && (
            <div className="data-voice mt-1.5 text-xs text-ripple-muted">
              {f.enRoute && f.arriveAtStopMs
                ? `You reach this stop ~${fmtTime(new Date(f.arriveAtStopMs).toISOString())} · bus at ${fmtTime(active.eta)}`
                : `Bus at ${fmtTime(active.eta)} · ~${f.walkMinutes} min walk`}
              {waitMin > 0 && ` + ~${waitMin} min wait`}
            </div>
          )}
        </>
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
  return <StatusBadge tier={riskTier(level)} label={RISK_LABELS[level]} />;
}

/**
 * One ambient status line (§3) merging weather and live MRT service — both are
 * unselected context, so they share a single muted row. The weather half turns
 * coloured/prominent only when there's an advisory (rain / heat); the MRT half
 * shows a dot + "All lines normal" / "N lines affected".
 */
function AmbientStatus({ weather }: { weather: WeatherContext | null }) {
  const { data: lines } = trpc.mrt.lineStatuses.useQuery(undefined, {
    staleTime: 60_000,
  });
  const affected = (lines ?? []).filter((l) => l.status !== "operational");
  const hasLines = !!lines && lines.length > 0;
  const mrtOk = affected.length === 0;

  const adv = weather?.advisory;
  const Icon = weather?.wet
    ? CloudRain
    : weather && /cloud/i.test(weather.forecast)
      ? Cloud
      : Sun;

  if (!weather && !hasLines) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-2 text-xs",
        adv?.level === "warning"
          ? "bg-warning/10"
          : adv
            ? "bg-brand/10"
            : "",
      )}
    >
      {weather && (
        <>
          <Icon
            size={14}
            className={cn(
              "shrink-0",
              adv?.level === "warning"
                ? "text-warning"
                : adv
                  ? "text-brand"
                  : "text-ripple-muted",
            )}
          />
          <span
            className={cn(
              "font-medium",
              adv?.level === "warning"
                ? "text-warning"
                : adv
                  ? "text-brand"
                  : "text-[var(--fg)]",
            )}
          >
            {weather.temperature != null
              ? `${Math.round(weather.temperature)}° · `
              : ""}
            {weather.forecast}
          </span>
          {adv && (
            <span className={adv.level === "warning" ? "text-warning" : "text-brand"}>
              — {adv.message}
            </span>
          )}
        </>
      )}
      {hasLines && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: mrtOk ? "#10b981" : "#f59e0b" }}
          />
          <span className={mrtOk ? "text-ripple-muted" : "text-warning"}>
            {mrtOk
              ? "All lines normal"
              : `${affected.length} line${affected.length > 1 ? "s" : ""} affected`}
          </span>
        </span>
      )}
    </div>
  );
}

function fmtCo2(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(1)} kg` : `${Math.round(grams)} g`;
}

/**
 * One Tier-2 savings line (§9): the headline CO₂ figure already lives in the
 * Tier-1 meta — here we only add what's new (savings vs taxi / driving).
 */
function CarbonSavingsLine({
  routeGrams,
  carbon,
}: {
  routeGrams: number;
  carbon: CarbonBaseline;
}) {
  const vsTaxi = Math.max(0, carbon.taxiGrams - routeGrams) / 1000;
  const vsCar = Math.max(0, carbon.carGrams - routeGrams) / 1000;
  return (
    <div className="data-voice flex items-center gap-1.5 text-xs text-ripple-muted">
      <Leaf size={12} className="shrink-0 text-ok" />
      <span>
        saves {vsTaxi.toFixed(2)} kg vs taxi · {vsCar.toFixed(2)} kg vs driving
      </span>
    </div>
  );
}

export function RouteResultsPanel({
  itineraries,
  selected,
  onSelect,
  onSave,
  onStartJourney,
  onLogTrip,
  tripLogged = false,
  weather,
  carbon,
  taxi,
  stopLabels,
  collapseKey,
}: {
  itineraries: Itinerary[];
  selected: number;
  onSelect: (i: number) => void;
  onSave?: () => void;
  onStartJourney?: () => void;
  /** Log the whole selected itinerary to Impact (carbon + distance). */
  onLogTrip?: (it: Itinerary) => void;
  tripLogged?: boolean;
  weather?: WeatherContext | null;
  carbon?: CarbonBaseline | null;
  taxi?: TaxiEstimate | null;
  /** Multi-stop destination labels, used for the via dividers in the stepper. */
  stopLabels?: string[];
  /** Collapse all cards when this changes (i.e. on a new search). */
  collapseKey?: string;
}) {
  // §9: every card renders Tier-1 only on load; leg detail is tap-to-expand.
  // Selection (map highlight) and expansion are deliberately decoupled.
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  useEffect(() => setExpandedIdx(null), [collapseKey]);

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
      <AmbientStatus weather={weather ?? null} />

      <div className="p-3">
        <div className="flex flex-col gap-2">
          {itineraries.map((it, i) => {
            const dev = Math.round((it.duration - fastest) / 60);
            const modes = journeyModes(it);
            const isSel = i === selected;
            const isExp = i === expandedIdx;
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
                {/* Summary row — tap selects (map) and toggles leg detail */}
                <button
                  onClick={() => {
                    onSelect(i);
                    setExpandedIdx((e) => (e === i ? null : i));
                  }}
                  aria-expanded={isExp}
                  className={cn(
                    "flex w-full flex-col gap-1 p-3 text-left",
                    isSel ? "bg-brand/5" : "hover:bg-ripple-muted/5",
                  )}
                >
                  {/* Hero row (§3): the two proven differentiators — ETA and
                      risk — get the weight. The top card's time is larger. */}
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cn(
                        "font-serif font-bold leading-none tracking-tight",
                        i === fastestIdx ? "text-[26px]" : "text-[22px]",
                      )}
                    >
                      {fmtDuration(it.duration)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {it.risk && <RiskPill level={it.risk.level} />}
                      <ChevronDown
                        size={15}
                        className={cn(
                          "shrink-0 text-ripple-muted transition-transform",
                          isExp && "rotate-180",
                        )}
                      />
                    </div>
                  </div>

                  {/* Ranking tag + mode sequence — one small mono line. */}
                  <div className="data-voice flex flex-wrap items-center gap-x-1.5 text-[11px] text-ripple-muted">
                    <span className="font-semibold uppercase tracking-[0.06em] text-brand">
                      {i === fastestIdx
                        ? "Fastest"
                        : showReliableTag && i === mostReliableIdx
                          ? "Most reliable"
                          : dev > 0
                            ? `+${dev} min`
                            : "Alternative"}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex flex-wrap items-center gap-x-1">
                      {modes.map((m, j) => (
                        <span key={j} className="inline-flex items-center gap-1">
                          {j > 0 && (
                            <ArrowRight
                              size={9}
                              className="text-ripple-muted"
                            />
                          )}
                          <span style={{ color: m.color }}>{m.label}</span>
                        </span>
                      ))}
                    </span>
                  </div>

                  {/* De-emphasised secondary metrics (§3). */}
                  <div className="mt-0.5 border-t border-[var(--border)] pt-1.5">
                    <span className="data-voice text-[11px] text-ripple-muted">
                      ${it.fare.toFixed(2)} ·{" "}
                      {it.transfers === 0
                        ? "direct"
                        : `${it.transfers} transfer${it.transfers > 1 ? "s" : ""}`}
                      {it.co2Grams != null && ` · ${fmtCo2(it.co2Grams)} CO₂`}
                    </span>
                  </div>
                </button>

                {/* Details — Tier 2, tap-to-expand only */}
                {isExp && (
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
                      <div className="border-b border-[var(--border)] px-3 py-2">
                        <CarbonSavingsLine
                          routeGrams={it.co2Grams}
                          carbon={carbon}
                        />
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
                              <span className="min-w-0 text-xs font-semibold">
                                {stopLabels?.[leg.viaStopIndex - 1] ??
                                  `Stop ${leg.viaStopIndex}`}
                              </span>
                            </div>
                          )}
                          <LegStep
                            leg={leg}
                            isLast={k === it.legs.length - 1}
                            prevEndMs={it.legs[k - 1]?.endTimeMs}
                          />
                        </Fragment>
                      ))}
                    </div>

                    {(onStartJourney || onSave || onLogTrip) && (
                      <div className="flex flex-col gap-2 px-3 pb-3">
                        <div className="flex gap-2">
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
                        {onLogTrip && (
                          <button
                            onClick={() => onLogTrip(it)}
                            disabled={tripLogged}
                            className={cn(
                              "flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold",
                              tripLogged
                                ? "border-ok/40 bg-ok/10 text-ok"
                                : "border-brand/40 bg-brand/5 text-brand hover:bg-brand/10",
                            )}
                          >
                            {tripLogged ? (
                              <>
                                <Check size={14} strokeWidth={2.5} /> Logged to
                                your Impact
                              </>
                            ) : (
                              <>
                                <Leaf size={14} /> Log this trip
                                {it.co2SavedGrams != null &&
                                  ` · saves ${(it.co2SavedGrams / 1000).toFixed(2)} kg`}
                              </>
                            )}
                          </button>
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
