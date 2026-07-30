import { Fragment, useEffect, useMemo, useState } from "react";
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
  Sun,
  ThermometerSun,
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
import { PrefMatchBadge, PrefMatchDetail } from "./PrefMatchBadge.js";
import { matchScores } from "@shared/prefMatch.js";
import { usePrefs } from "../lib/prefs.js";
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

/** Trim "MRT Station"/"LRT Station"/"Station" noise so a rail leg reads
 *  "Jurong East → Bugis", not "Jurong East MRT Station → Bugis MRT Station". */
function shortStation(n?: string | null): string | undefined {
  if (!n) return undefined;
  return n.replace(/\s*(MRT|LRT)?\s*station\b/i, "").trim() || n;
}

function legTitle(leg: RouteLeg): string {
  if (leg.type === "walk" || leg.type === "cycle") {
    const verb = leg.type === "walk" ? "Walk" : "Cycle";
    const to = shortStation(
      cleanName(leg.toName) ?? leg.endBusStop ?? leg.endStation,
    );
    return to ? `${verb} to ${to}` : verb;
  }
  if (leg.type === "mrt")
    return `${shortStation(leg.startStation) ?? "Board"} → ${shortStation(leg.endStation) ?? "Alight"}`;
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

  // A sub-minute access walk ("0 min · 14m") reads as broken — show just the
  // distance for trivial walk/cycle hops.
  const trivialWalk =
    (leg.type === "walk" || leg.type === "cycle") && leg.duration < 60;

  // Scheduled platform wait for an MRT leg: gap between reaching the station
  // (previous leg's scheduled end) and the train's scheduled departure. OTP's
  // timetable is the source of truth; live arrivals aren't published for rail.
  const mrtWaitMin =
    leg.type === "mrt" && leg.startTimeMs != null && prevEndMs != null
      ? Math.max(0, Math.round((leg.startTimeMs - prevEndMs) / 60000))
      : null;

  // One consolidated MRT line — stops + departure + platform wait — instead of
  // a separate stops row and a "· scheduled" departs row (rail is always
  // timetabled, so the word "scheduled" added nothing).
  const mrtMeta =
    leg.type === "mrt"
      ? [
          leg.numStops
            ? `${leg.numStops} stop${leg.numStops > 1 ? "s" : ""}`
            : null,
          leg.startTimeMs != null
            ? `departs ${fmtTime(new Date(leg.startTimeMs).toISOString())}`
            : null,
          mrtWaitMin != null && mrtWaitMin > 0 ? `+${mrtWaitMin} min wait` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

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
            {trivialWalk
              ? fmtDistance(leg.distance)
              : `${fmtDuration(leg.duration)} · ${fmtDistance(leg.distance)}`}
          </span>
        </div>
        {/* Bus stops counter — MRT folds its stop count into the consolidated
            departs line below. */}
        {leg.type === "bus" && leg.numStops ? (
          <div className="data-voice mt-0.5 text-[11px] font-medium text-ripple-muted">
            {leg.numStops} stop{leg.numStops > 1 ? "s" : ""}
          </div>
        ) : null}

        {leg.walkEstimated && (
          <div className="mt-0.5 text-xs text-ripple-muted">
            Estimated walk — we couldn't map a footpath from this address
          </div>
        )}

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

        {mrtMeta && (
          <div className="data-voice mt-0.5 text-xs text-ripple-muted">
            {mrtMeta}
          </div>
        )}

        {/* Exit wayfinding + platform crowd share one chip row so the rail leg
            stays compact. Exit is neutral cyan (wayfinding, not a warning). */}
        {leg.type === "mrt" &&
          (leg.exitName || leg.crowd === "h" || leg.crowd === "m") && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {leg.exitName && (
                <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                  <DoorOpen size={12} /> {leg.exitName}
                  {leg.exitDistanceM != null &&
                    ` · ${fmtDistance(leg.exitDistanceM)}`}
                </span>
              )}
              {(leg.crowd === "h" || leg.crowd === "m") && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                    leg.crowd === "h"
                      ? "bg-warning/10 text-warning"
                      : "bg-ripple-muted/10 text-ripple-muted",
                  )}
                >
                  <Users size={12} />
                  {leg.crowd === "h" ? "Crowded platform" : "Moderate crowd"}
                </span>
              )}
              {leg.exitName &&
                leg.exitAlternatives &&
                leg.exitAlternatives.length > 0 && (
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
 * Contextual weather + service status above the results. The raw temperature
 * now lives in Pulse, so this mirrors the Walk/Cycle advisory strip: a positive
 * "Good conditions" note, or the rain/heat advisory when there's one. An MRT
 * line disruption surfaces only when something is actually affected (all-normal
 * is Pulse's job) — never the old always-on "All lines normal" row.
 */
function ContextualStatus({ weather }: { weather: WeatherContext | null }) {
  const { data: lines } = trpc.mrt.lineStatuses.useQuery(undefined, {
    staleTime: 60_000,
  });
  const affected = (lines ?? []).filter((l) => l.status !== "operational");

  const adv = weather?.advisory;
  const level: "good" | "info" | "warning" = adv?.level ?? "good";
  const message = adv
    ? adv.message
    : `Good conditions right now${weather?.area ? ` (near ${weather.area})` : ""}`;
  const Icon =
    level === "warning" ? CloudRain : level === "info" ? ThermometerSun : Sun;

  if (!weather && affected.length === 0) return null;

  return (
    <>
      {weather && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs",
            level === "warning"
              ? "bg-warning/10 text-warning"
              : level === "info"
                ? "bg-brand/10 text-brand"
                : "bg-ok/10 text-ok",
          )}
        >
          <Icon size={14} className="shrink-0" />
          <span className="font-medium">{message}</span>
        </div>
      )}
      {affected.length > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <TriangleAlert size={14} className="shrink-0" />
          <span className="font-medium">
            {affected.length} MRT line{affected.length > 1 ? "s" : ""} affected —
            see Pulse
          </span>
        </div>
      )}
    </>
  );
}

function fmtCo2(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(1)} kg` : `${Math.round(grams)} g`;
}

/**
 * The consolidated CO₂ line (expanded only): the route's own emissions plus
 * what it saves vs taxi / driving. Usage was removed from the Tier-1 fold so
 * the whole carbon picture reads in one place here.
 */
function CarbonSavingsLine({
  routeGrams,
  carbon,
}: {
  routeGrams: number;
  carbon: CarbonBaseline | null;
}) {
  const savings = carbon
    ? ` · saves ${(Math.max(0, carbon.taxiGrams - routeGrams) / 1000).toFixed(2)} kg vs taxi · ${(Math.max(0, carbon.carGrams - routeGrams) / 1000).toFixed(2)} kg vs driving`
    : "";
  return (
    <div className="data-voice flex items-center gap-1.5 text-xs text-ripple-muted">
      <Leaf size={12} className="shrink-0 text-ok" />
      <span>
        {fmtCo2(routeGrams)} CO₂{savings}
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
  onExpandChange,
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
  /** Notifies the parent when a card is expanded, so the sticky search header
   *  can unfreeze to give the expanded content room. */
  onExpandChange?: (expanded: boolean) => void;
}) {
  // §9: every card renders Tier-1 only on load; leg detail is tap-to-expand.
  // Selection (map highlight) and expansion are deliberately decoupled.
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  useEffect(() => setExpandedIdx(null), [collapseKey]);
  useEffect(
    () => onExpandChange?.(expandedIdx !== null),
    [expandedIdx, onExpandChange],
  );

  // §4.4 preference match — relative to this search only, and only when the
  // user has actually stated a preference (otherwise every entry is null).
  const { prefs } = usePrefs();
  const matches = useMemo(
    () => matchScores(itineraries, prefs),
    [itineraries, prefs],
  );

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
    <div className="p-3">
      <div className="flex flex-col gap-2">
        <ContextualStatus weather={weather ?? null} />
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
                    {/* Risk is flagged on the collapsed card whenever it's
                        present; the detailed reasons live in the expanded view
                        (the chevron moved to the labeled footer row below). */}
                    {it.risk && <RiskPill level={it.risk.level} />}
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

                  {/* De-emphasised secondary metrics (§3) — the preference
                      match rides this row so it can't rival the ETA/risk hero. */}
                  <div className="mt-0.5 flex items-center gap-2 border-t border-[var(--border)] pt-1.5">
                    {/* CO₂ usage moved off the first fold — it now rides the
                        consolidated CO₂ line in the expanded view (usage +
                        savings together), keeping this row to fare + transfers. */}
                    <span className="data-voice text-[11px] text-ripple-muted">
                      ${it.fare.toFixed(2)} ·{" "}
                      {it.transfers === 0
                        ? "direct"
                        : `${it.transfers} transfer${it.transfers > 1 ? "s" : ""}`}
                    </span>
                    {matches[i] && (
                      <PrefMatchBadge match={matches[i]!} className="ml-auto" />
                    )}
                  </div>

                  {/* Style-1 expand cue — matches the walk/cycle card: names the
                      detail that opens on tap; the chevron flips when expanded. */}
                  <div
                    className={cn(
                      "-mx-3 -mb-3 mt-0.5 flex items-center justify-between border-t border-[var(--border)] px-3 py-2 font-mono text-[11px] text-ripple-muted",
                      isExp && "bg-ripple-muted/5",
                    )}
                  >
                    <span>Route steps, risks &amp; CO₂ savings</span>
                    <ChevronDown
                      size={14}
                      className={cn(
                        "transition-transform",
                        isExp && "rotate-180",
                      )}
                    />
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

                    {matches[i] && (
                      <div className="border-b border-[var(--border)] px-3 py-2">
                        <PrefMatchDetail match={matches[i]!} prefs={prefs} />
                      </div>
                    )}

                    {it.co2Grams != null && (
                      <div className="border-b border-[var(--border)] px-3 py-2">
                        <CarbonSavingsLine
                          routeGrams={it.co2Grams}
                          carbon={carbon ?? null}
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
  );
}
