import { useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import {
  Footprints,
  TrainFront,
  Bus,
  Bike,
  Navigation,
  X,
  ChevronLeft,
  ArrowRight,
  Check,
  Share2,
  DoorOpen,
  Clock,
  TriangleAlert,
  RotateCcw,
  Loader2,
  Leaf,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useJourney, type ActiveJourney } from "../lib/journey.js";
import { useGeolocation } from "../lib/useGeolocation.js";
import { useAuth } from "../lib/auth.js";
import { trpc } from "../lib/trpc.js";
import { MapView } from "../components/MapView.js";
import { Button, Card, Modal } from "../components/ui.js";
import { lineColor, lineName } from "../lib/transit.js";
import {
  fmtDistance,
  fmtDuration,
  fmtTime,
  haversineMeters,
  bearingBetween,
  cn,
} from "../lib/utils.js";
import type { RouteLeg, Itinerary, LatLng } from "@shared/types.js";

const ARRIVE_THRESHOLD_M = 45; // walk/cycle: you're on foot, GPS is fairly tight
const ARRIVE_TRANSIT_M = 150; // bus/MRT: station GPS is coarser and you arrive fast
const MIN_MOVE_M = 20; // must have moved this far since the leg began before an arrival counts

function legIcon(type: RouteLeg["type"], size = 20) {
  if (type === "walk") return <Footprints size={size} />;
  if (type === "cycle") return <Bike size={size} />;
  if (type === "bus") return <Bus size={size} />;
  return <TrainFront size={size} />;
}

function instruction(leg: RouteLeg): { title: string; detail: string } {
  if (leg.type === "walk" || leg.type === "cycle")
    return {
      title: leg.type === "walk" ? "Walk" : "Cycle",
      detail: `to ${leg.toName ?? leg.endStation ?? leg.endBusStop ?? "the next point"}`,
    };
  if (leg.type === "bus")
    return {
      title: `Bus ${leg.busNo ?? ""}`.trim(),
      detail: `Board at ${leg.startBusStop ?? "the stop"} → alight at ${leg.endBusStop ?? "your stop"}`,
    };
  return {
    title: `${leg.lineCode ? leg.lineCode + " · " : ""}${lineName(leg.lineCode)}`,
    detail: `Ride to ${leg.endStation ?? "your station"}`,
  };
}

/** Impact mode: cycle if any cycle leg, walk if all walking, else transit. */
function journeyMode(legs: RouteLeg[]): "walk" | "cycle" | "transit" {
  return legs.some((l) => l.type === "cycle")
    ? "cycle"
    : legs.every((l) => l.type === "walk")
      ? "walk"
      : "transit";
}

/** Cumulative distance/carbon completed so far: banked prior-itinerary totals
 *  (across re-routes) plus a distance-proportional share of the current
 *  itinerary's completed legs. */
function journeyProgress(j: ActiveJourney): {
  m: number;
  co2: number;
  saved: number;
} {
  const legs = j.itinerary.legs;
  const doneCount = j.status === "completed" ? legs.length : j.currentLeg;
  const doneDist = legs.slice(0, doneCount).reduce((s, l) => s + l.distance, 0);
  const totalDist = legs.reduce((s, l) => s + l.distance, 0) || 1;
  const frac = Math.min(1, doneDist / totalDist);
  return {
    m: (j.bankedM ?? 0) + Math.round(doneDist),
    co2: (j.bankedCo2 ?? 0) + Math.round((j.itinerary.co2Grams ?? 0) * frac),
    saved:
      (j.bankedSaved ?? 0) +
      Math.round((j.itinerary.co2SavedGrams ?? 0) * frac),
  };
}

export function LiveJourney() {
  const {
    journey,
    advance,
    back,
    end,
    start: startJourney,
    setLogId,
    reroute: rerouteJourney,
  } = useJourney();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const active = !!journey && journey.status === "active";
  const geo = useGeolocation(active);
  const logged = useRef(false);
  // Position where the current leg began, so an arrival only counts once we've
  // actually moved (real travel, not GPS jitter). Survives GPS gaps — e.g. an
  // underground MRT leg where the first fix reappears near the destination
  // still shows a large move from the boarding point, so it advances.
  const legStart = useRef<{ idx: number; pos: LatLng } | null>(null);
  const logTrip = trpc.sustainability.logTrip.useMutation();
  const updateTrip = trpc.sustainability.updateTrip.useMutation();

  const legs = journey?.itinerary.legs ?? [];
  const leg = journey ? legs[journey.currentLeg] : undefined;
  const upcoming = journey ? legs[journey.currentLeg + 1] : undefined;

  // Live transit alerts: watch the bus you're heading to / boarding, and flag
  // MRT disruptions on the current or next leg.
  const busLeg =
    leg?.type === "bus" ? leg : upcoming?.type === "bus" ? upcoming : undefined;
  const mrtLeg =
    leg?.type === "mrt" ? leg : upcoming?.type === "mrt" ? upcoming : undefined;

  const arrivals = trpc.lta.busArrivals.useQuery(
    busLeg?.busStopCode
      ? { busStopCode: busLeg.busStopCode, serviceNo: busLeg.busNo }
      : (undefined as never),
    { enabled: active && !!busLeg?.busStopCode, refetchInterval: 15_000 },
  );
  const lineStatuses = trpc.mrt.lineStatuses.useQuery(undefined, {
    enabled: active && !!mrtLeg,
    staleTime: 60_000,
  });

  const utils = trpc.useUtils();
  const [reroute, setReroute] = useState<{
    itinerary: Itinerary;
    start: LatLng;
  } | null>(null);
  const [rerouteLoading, setRerouteLoading] = useState(false);
  // Map + sheet view: the current leg (tight) or the whole remaining route.
  const [viewMode, setViewMode] = useState<"leg" | "route">("leg");
  // Re-render periodically so the ETA and live countdowns stay fresh even while
  // the user is stationary (waiting at a stop) and GPS isn't updating.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Auto-advance the journey by GPS, for every leg type — walk/cycle when you
  // reach the next point, bus/MRT when you arrive at the alighting stop/station
  // — so the phase tracks your location like Google Maps. The manual Back /
  // Done buttons remain as a fallback (and cover very short legs, see below).
  useEffect(() => {
    if (!journey || !leg || !geo.position || journey.status !== "active") return;
    const idx = journey.currentLeg;

    // Anchor the leg's starting position on the first fix after it becomes
    // current.
    if (!legStart.current || legStart.current.idx !== idx) {
      legStart.current = { idx, pos: geo.position };
    }

    const arriveAt =
      leg.type === "walk" || leg.type === "cycle"
        ? ARRIVE_THRESHOLD_M
        : ARRIVE_TRANSIT_M;
    const dist = haversineMeters(geo.position, leg.endPoint);
    const moved = haversineMeters(legStart.current.pos, geo.position);

    // Advance once you're at the leg's end AND have actually moved since it
    // began — so we never skip a leg from jitter, but any real progress
    // (including a short transfer) still auto-advances.
    if (dist < arriveAt && moved >= MIN_MOVE_M) {
      legStart.current = { idx: idx + 1, pos: geo.position };
      advance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.position]);

  const completed = journey?.status === "completed";
  const progress = journey ? journeyProgress(journey) : null;

  // "Log as you go": once logging is armed (a row id exists), keep the row's
  // cumulative distance/carbon current as legs complete or a re-route banks
  // earlier progress — so one click logs everything up to any point, then the
  // rest dynamically.
  useEffect(() => {
    if (!journey?.logId || !progress) return;
    updateTrip.mutate({
      id: journey.logId,
      co2Grams: progress.co2,
      savedGrams: progress.saved,
      distanceM: progress.m,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey?.logId, journey?.currentLeg, completed]);

  // Backwards-compatible auto-log on completion — only when the user never
  // pressed "Log trip" (no row id), so we never double-count.
  useEffect(() => {
    if (!journey || !completed || !user || journey.logId || logged.current)
      return;
    logged.current = true;
    logTrip.mutate(
      {
        origin: journey.originText || "Origin",
        destination: journey.destText || "Destination",
        mode: journeyMode(journey.itinerary.legs),
        co2Grams: journey.itinerary.co2Grams ?? 0,
        savedGrams: journey.itinerary.co2SavedGrams ?? 0,
        distanceM: Math.round(legs.reduce((s, l) => s + l.distance, 0)),
      },
      { onSuccess: () => toast.success("Journey logged to your Impact.") },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);

  // The "Log trip" CTA: arm logging and create the row with progress so far.
  function handleLogTrip() {
    if (!journey || !progress) return;
    if (!user) {
      toast.error("Sign in to log trips to your Impact.");
      return;
    }
    if (journey.logId) return; // already logging — the effect keeps it current
    logTrip.mutate(
      {
        origin: journey.originText || "Origin",
        destination: journey.destText || "Destination",
        mode: journeyMode(journey.itinerary.legs),
        co2Grams: progress.co2,
        savedGrams: progress.saved,
        distanceM: progress.m,
      },
      {
        onSuccess: ({ id }) => {
          setLogId(id);
          toast.success("Logging this journey to your Impact.");
        },
        onError: () => toast.error("Couldn't start logging — try again."),
      },
    );
  }

  if (!journey) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="text-sm text-ripple-muted">No active journey.</p>
          <Link
            href="/"
            className="mt-3 inline-block text-sm font-medium text-brand hover:underline"
          >
            ← Plan a route
          </Link>
        </div>
      </div>
    );
  }

  if (completed) {
    return (
      <CompletionSummary
        journey={journey}
        onDone={() => {
          end();
          navigate("/");
        }}
      />
    );
  }

  const legNum = journey.currentLeg + 1;
  const total = legs.length;
  const isLast = journey.currentLeg >= total - 1;
  const nextLeg = legs[journey.currentLeg + 1];
  // Remaining distance to the leg end. Clamp to the leg's own length: an
  // off/fallback GPS fix can otherwise report a straight-line distance longer
  // than the whole leg (the "3.8km · ~1 min" bug), so never show more than the
  // planned leg distance.
  const remainingM = leg
    ? geo.position
      ? Math.min(haversineMeters(geo.position, leg.endPoint), leg.distance)
      : leg.distance
    : 0;
  const legColor =
    leg?.type === "walk"
      ? "#22c55e"
      : leg?.type === "cycle"
        ? "#0ea5e9"
        : leg?.type === "bus"
          ? "#3b82f6"
          : lineColor(leg?.lineCode);

  // Walk/cycle legs get a tilted, heading-up 3D navigation view that follows
  // you — but only in the "current leg" camera mode; the "full route" mode
  // fits the whole remaining journey instead.
  const walkCamera:
    | { pitch: number; bearing: number; follow: LatLng; followZoom: number }
    | Record<string, never> =
    viewMode === "leg" && (leg?.type === "walk" || leg?.type === "cycle")
      ? {
          pitch: 55,
          bearing: geo.position
            ? bearingBetween(geo.position, leg.endPoint)
            : bearingBetween(leg.startPoint, leg.endPoint),
          follow: geo.position ?? leg.startPoint,
          followZoom: 18,
        }
      : {};

  const busEta = arrivals.data?.services.find(
    (s) => s.serviceNo === busLeg?.busNo,
  )?.nextBus?.estimatedArrival;
  const busMin =
    busEta != null
      ? Math.max(0, Math.round((new Date(busEta).getTime() - Date.now()) / 60000))
      : null;
  const mrtDisrupted = mrtLeg
    ? lineStatuses.data?.find(
        (l) => l.lineCode === mrtLeg.lineCode && l.status !== "operational",
      )
    : undefined;

  // Remaining time on the original plan (from the current leg onward).
  const remainingMin = Math.round(
    legs.slice(journey.currentLeg).reduce((s, l) => s + l.duration, 0) / 60,
  );
  // The watched bus looks gone if its ETA has already passed.
  const busDeparted =
    busLeg != null && busEta != null && new Date(busEta).getTime() < Date.now();

  // Journey-wide ETA (§3.1): plan minutes from the current leg onward, projected
  // onto the wall clock. Refreshed by the 30s tick and by GPS updates.
  const arrivalMs = Date.now() + remainingMin * 60_000;
  const arrivalClock = fmtTime(new Date(arrivalMs).toISOString());

  // Live risk (§4): re-evaluate the catch/disruption risk against live data for
  // the leg in progress (and the bus/MRT one leg ahead).
  const risk = liveRisk({ leg, busLeg, busMin, remainingM, mrtDisrupted });

  // Camera target (§2): full route fits the remaining journey; current-leg mode
  // fits the current transit leg (walk/cycle use the follow camera above).
  const remainingLegPoints = legs
    .slice(journey.currentLeg)
    .flatMap((l) => [l.startPoint, l.endPoint]);
  const fitPoints: LatLng[] | null =
    viewMode === "route"
      ? [...remainingLegPoints, journey.destination]
      : leg && leg.type !== "walk" && leg.type !== "cycle"
        ? [leg.startPoint, leg.endPoint]
        : null;

  async function handleReroute() {
    const start = geo.position ?? leg?.startPoint ?? journey!.origin;
    setRerouteLoading(true);
    try {
      const res = await utils.onemap.route.fetch({
        start,
        end: journey!.destination,
        mode: "TRANSIT",
      });
      const best = res.plan.itineraries[0];
      if (best) setReroute({ itinerary: best, start });
      else toast.error("No alternative route found from here.");
    } catch {
      toast.error("Couldn't recalculate — try again.");
    } finally {
      setRerouteLoading(false);
    }
  }

  function acceptReroute() {
    if (!reroute) return;
    // Bank the distance/carbon completed on the current itinerary so an active
    // impact log keeps a correct cumulative total across the switch.
    const banked = journey
      ? journeyProgress(journey)
      : { m: 0, co2: 0, saved: 0 };
    const params = {
      itinerary: reroute.itinerary,
      originText: "Current location",
      destText: journey!.destText,
      origin: reroute.start,
      destination: journey!.destination,
    };
    if (journey?.logId) {
      rerouteJourney(params, banked);
    } else {
      startJourney(params);
    }
    setReroute(null);
    toast.success("Re-routed from your current location.");
  }

  return (
    <div className="flex h-full flex-col">
      {/* One-line journey header (§4/§6c): leg progress + ETA, journey-scoped so
          it persists across leg transitions. Replaces the stacked
          progress-dots + ETA-banner treatment. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <button
          onClick={() => navigate("/")}
          aria-label="Back to map"
          className="shrink-0 rounded-md p-1 text-ripple-muted hover:bg-ripple-muted/10 hover:text-[var(--fg)]"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0 flex-1 truncate text-center text-sm">
          <span className="text-ripple-muted">
            Leg {legNum} of {total} · Arriving{" "}
          </span>
          <span className="data-voice font-semibold text-brand">
            {arrivalClock}
          </span>
          <span className="text-ripple-muted"> · {remainingMin} min left</span>
        </div>
        <button
          onClick={() => end()}
          aria-label="End journey"
          className="shrink-0 rounded-md p-1 text-ripple-muted hover:bg-ripple-muted/10 hover:text-[var(--fg)]"
        >
          <X size={18} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <MapView
          origin={journey.origin}
          destination={journey.destination}
          itinerary={journey.itinerary}
          livePosition={geo.position}
          fitPoints={fitPoints}
          viewToggle={{
            mode: viewMode,
            onChange: () =>
              setViewMode((m) => (m === "leg" ? "route" : "leg")),
          }}
          {...walkCamera}
        />
        {!geo.supported && (
          <div className="absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-full bg-warning/90 px-3 py-1 text-xs font-medium text-white">
            Live location not available on this device
          </div>
        )}
        {geo.error && (
          <div className="absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-full bg-warning/90 px-3 py-1 text-xs font-medium text-white">
            {geo.error} — use the buttons to advance
          </div>
        )}
      </div>

      {/* Guidance sheet */}
      <div className="max-h-[55%] shrink-0 overflow-y-auto border-t border-[var(--border)] bg-[var(--surface)] p-4">
        {viewMode === "route" && (
          <div className="mb-2 eyebrow text-ripple-muted">Full route</div>
        )}

        {viewMode === "route" ? (
          <FullStepper legs={legs} current={journey.currentLeg} />
        ) : (
          <>
            <CurrentNextStepper
              leg={leg}
              nextLeg={nextLeg}
              legColor={legColor}
              remainingM={remainingM}
            />

            {/* Live status — the single most decision-relevant live fact,
                promoted to its own tinted container. Escalates to an amber/red
                risk banner (with an attached re-route CTA) when live data turns
                the catch tight/missed or a disruption newly applies (§4). */}
            {risk ? (
              <RiskBanner
                risk={risk}
                loading={rerouteLoading}
                onReroute={handleReroute}
              />
            ) : (
              <LiveStatus busLeg={busLeg} busMin={busMin} />
            )}

            {nextLeg && <NextPreview leg={nextLeg} />}
          </>
        )}

        {/* Log-this-journey CTA (§ trip logging): press once to commit the
            distance/carbon accrued up to now; it then keeps counting (and
            survives re-routes) until the journey ends. */}
        {progress && (
          <button
            onClick={handleLogTrip}
            disabled={!!journey.logId || logTrip.isPending}
            className={cn(
              "mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold",
              journey.logId
                ? "border-ok/40 bg-ok/10 text-ok"
                : "border-brand/40 bg-brand/5 text-brand hover:bg-brand/10",
            )}
          >
            {journey.logId ? (
              <>
                <Check size={14} strokeWidth={2.5} /> Logging ·{" "}
                {(progress.m / 1000).toFixed(1)} km ·{" "}
                {(progress.co2 / 1000).toFixed(2)} kg CO₂
              </>
            ) : logTrip.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <>
                <Leaf size={14} /> Log this journey to my Impact
              </>
            )}
          </button>
        )}

        <div className="mt-2.5 flex gap-2">
          {journey.currentLeg > 0 && (
            <Button variant="outline" size="md" onClick={back}>
              Back
            </Button>
          )}
          <Button variant="accent" className="flex-1" onClick={advance}>
            {isLast ? "Finish journey" : "Done — next leg"}{" "}
            {!isLast && <ArrowRight size={16} />}
          </Button>
        </div>

        {/* Quiet secondary re-route — the default, no-risk affordance. When a
            live risk is flagged the prominent attached CTA in RiskBanner takes
            over, so this is hidden to avoid a duplicate. */}
        {(busLeg || mrtLeg) && !risk && viewMode === "leg" && (
          <button
            onClick={handleReroute}
            disabled={rerouteLoading}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 text-xs font-medium text-ripple-muted hover:text-brand"
          >
            {rerouteLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RotateCcw size={13} />
            )}
            {busDeparted ? "Missed it? Find a better route" : "Re-route from here"}
          </button>
        )}
      </div>

      <Modal
        open={!!reroute}
        onClose={() => setReroute(null)}
        title="Better route from here"
      >
        {reroute && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="text-base font-semibold">
                {fmtDuration(reroute.itinerary.duration)}
              </div>
              <div className="mt-1 text-xs text-ripple-muted">
                {reroute.itinerary.legs
                  .filter((l) => l.type !== "walk")
                  .map((l) => l.busNo ?? l.lineCode ?? l.type)
                  .join(" → ") || "Walking route"}
                {" · "}${reroute.itinerary.fare.toFixed(2)} ·{" "}
                {reroute.itinerary.transfers} transfer
                {reroute.itinerary.transfers === 1 ? "" : "s"}
              </div>
            </div>
            <p className="text-xs text-ripple-muted">
              Your original plan had about {remainingMin} min left.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setReroute(null)}
              >
                Keep original
              </Button>
              <Button
                variant="accent"
                className="flex-1"
                onClick={acceptReroute}
              >
                Take new route
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Live-companion pieces ─────────────────────────────────────
type RiskInfo = { level: "tight" | "miss"; headline: string; caption: string };

/**
 * Re-evaluate catch/disruption risk against live data for the leg in progress
 * (and the bus/MRT one leg ahead). Amber = tight, red = miss; null = no risk.
 */
function liveRisk({
  leg,
  busLeg,
  busMin,
  remainingM,
  mrtDisrupted,
}: {
  leg: RouteLeg | undefined;
  busLeg: RouteLeg | undefined;
  busMin: number | null;
  remainingM: number;
  mrtDisrupted: { lineCode: string; status: string; message?: string } | undefined;
}): RiskInfo | null {
  // Heading to a bus (not already riding it) with a live arrival: re-score the
  // catch. The bus can now be arriving sooner than the plan assumed.
  if (leg && leg.type !== "bus" && busLeg && busMin != null) {
    const walkMin = remainingM / 80; // ~80 m/min on foot
    const buffer = busMin - walkMin;
    if (buffer < 0)
      return {
        level: "miss",
        headline: `Bus arriving in ${busMin} min — you may miss it`,
        caption: "coming sooner than planned — consider the next one",
      };
    if (buffer < 2)
      return {
        level: "tight",
        headline: `Bus now arriving in ${busMin} min — tight`,
        caption: "you may not make it at this pace",
      };
  }
  if (mrtDisrupted)
    return {
      level: "tight",
      headline: `${mrtDisrupted.lineCode} line ${mrtDisrupted.status}`,
      caption: mrtDisrupted.message || "expect delays on the line ahead",
    };
  return null;
}

/** Current leg: full-size filled node (with a "you are here" halo), title,
 *  from/to detail, exit badge (MRT), and distance · duration. */
function CurrentNextStepper({
  leg,
  nextLeg,
  legColor,
  remainingM,
}: {
  leg: RouteLeg | undefined;
  nextLeg: RouteLeg | undefined;
  legColor: string;
  remainingM: number;
}) {
  if (!leg) return null;
  const instr = instruction(leg);
  const onFoot = leg.type === "walk" || leg.type === "cycle";
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: legColor, boxShadow: `0 0 0 5px ${legColor}33` }}
        >
          {legIcon(leg.type)}
        </span>
        {nextLeg && (
          <span className="mt-1 min-h-[14px] w-0.5 flex-1 bg-[var(--border)]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold">{instr.title}</div>
        <div className="text-sm text-ripple-muted">{instr.detail}</div>
        {leg.type === "mrt" && leg.exitName && (
          <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
            <DoorOpen size={12} /> {leg.exitName}
            {leg.exitDistanceM != null && ` · ${fmtDistance(leg.exitDistanceM)}`}
          </div>
        )}
        <div className="data-voice mt-1 flex items-center gap-1.5 text-xs text-ripple-muted">
          <Navigation size={12} />
          {onFoot
            ? `${fmtDistance(remainingM)} · ~${fmtDuration(leg.duration)}`
            : fmtDuration(leg.duration)}
        </div>
      </div>
    </div>
  );
}

/** Dimmed one-line preview of the next leg, connected to the current node. */
function NextPreview({ leg }: { leg: RouteLeg }) {
  return (
    <div className="mt-2.5 flex items-center gap-3 opacity-55">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-ripple-muted">
        {legIcon(leg.type, 12)}
      </span>
      <span className="truncate text-xs text-ripple-muted">
        Then {instruction(leg).title} · {fmtDuration(leg.duration)}
      </span>
    </div>
  );
}

/** Promoted live-status container (no risk): the current live fact, icon-led,
 *  two-line. Renders nothing when there's no live signal. */
function LiveStatus({
  busLeg,
  busMin,
}: {
  busLeg: RouteLeg | undefined;
  busMin: number | null;
}) {
  if (!busLeg || busMin == null) return null;
  return (
    <div className="mt-2.5 flex items-center gap-2.5 rounded-lg bg-bus/10 px-3 py-2.5">
      <Clock size={18} className="shrink-0 text-bus" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-bus">
          Bus {busLeg.busNo}{" "}
          {busMin === 0 ? "arriving now" : `arrives in ${busMin} min`}
        </div>
        <div className="data-voice text-[11px] text-bus/80">
          {busLeg.startBusStop ? `at ${busLeg.startBusStop} · ` : ""}live
        </div>
      </div>
    </div>
  );
}

/** Escalated risk banner (§4): tinted amber/red, icon-led, with its own
 *  attached re-route CTA — the prominent state that overrides the quiet link. */
function RiskBanner({
  risk,
  loading,
  onReroute,
}: {
  risk: RiskInfo;
  loading: boolean;
  onReroute: () => void;
}) {
  const miss = risk.level === "miss";
  const tone = miss
    ? { bg: "bg-error/10", border: "border-error/30", fg: "text-error" }
    : { bg: "bg-warning/10", border: "border-warning/30", fg: "text-warning" };
  return (
    <div
      className={cn("mt-2.5 rounded-lg border p-2.5", tone.bg, tone.border)}
    >
      <div className="flex items-start gap-2">
        <TriangleAlert size={18} className={cn("shrink-0", tone.fg)} />
        <div className="min-w-0">
          <div className={cn("text-sm font-semibold", tone.fg)}>
            {risk.headline}
          </div>
          <div className={cn("data-voice text-[11px] opacity-80", tone.fg)}>
            {risk.caption}
          </div>
        </div>
      </div>
      <button
        onClick={onReroute}
        disabled={loading}
        className={cn(
          "mt-2 flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold text-white",
          miss ? "bg-error" : "bg-warning",
        )}
      >
        {loading ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <RotateCcw size={13} />
        )}
        Re-route from here
      </button>
    </div>
  );
}

/** Full-journey completion stepper (§3a) — every leg's done/current/upcoming
 *  state, keeping the mode icon and adding a completion badge / halo. Lives in
 *  the map toggle's "full route" state. */
function FullStepper({ legs, current }: { legs: RouteLeg[]; current: number }) {
  return (
    <div className="flex flex-col">
      {legs.map((l, i) => {
        const done = i < current;
        const isCurrent = i === current;
        const instr = instruction(l);
        const color =
          l.type === "walk"
            ? "#22c55e"
            : l.type === "cycle"
              ? "#0ea5e9"
              : l.type === "bus"
                ? "#3b82f6"
                : lineColor(l.lineCode);
        return (
          <div key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "relative flex shrink-0 items-center justify-center rounded-full",
                  isCurrent ? "h-9 w-9" : "h-7 w-7",
                )}
                style={
                  done || isCurrent
                    ? {
                        background: color,
                        color: "#fff",
                        boxShadow: isCurrent ? `0 0 0 5px ${color}33` : undefined,
                      }
                    : {
                        background: "transparent",
                        border: "1.5px solid var(--border)",
                        color: "var(--muted)",
                      }
                }
              >
                {legIcon(l.type, isCurrent ? 16 : 13)}
                {done && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ok ring-2 ring-[var(--surface)]">
                    <Check size={9} strokeWidth={3} className="text-white" />
                  </span>
                )}
              </span>
              {i < legs.length - 1 && (
                <span className="my-1 min-h-[14px] w-0.5 flex-1 bg-[var(--border)]" />
              )}
            </div>
            <div
              className={cn(
                "min-w-0 flex-1 pb-3",
                !done && !isCurrent && "opacity-55",
              )}
            >
              <div
                className={cn(
                  "text-sm",
                  isCurrent ? "font-semibold text-[var(--fg)]" : "text-[var(--fg)]",
                  done && "text-ripple-muted",
                )}
              >
                {instr.title}
              </div>
              <div className="data-voice text-[11px] text-ripple-muted">
                {fmtDuration(l.duration)}
                {isCurrent ? " · current" : done ? " · done" : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CompletionSummary({
  journey,
  onDone,
}: {
  journey: ActiveJourney;
  onDone: () => void;
}) {
  const legs = journey.itinerary.legs;
  const totalMs = (journey.completedAt ?? Date.now()) - journey.startedAt;
  const totalMin = Math.max(1, Math.round(totalMs / 60000));
  const distanceM = legs.reduce((s, l) => s + l.distance, 0);
  const co2Kg = (journey.itinerary.co2Grams ?? 0) / 1000;

  return (
    <div className="mx-auto flex h-full max-w-md flex-col overflow-y-auto p-5">
      <div className="mt-4 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ok/15">
          <Check size={32} className="text-ok" strokeWidth={3} />
        </div>
        <h1 className="mt-3 font-serif text-3xl font-bold tracking-tight">
          Journey complete
        </h1>
        <p className="text-sm text-ripple-muted">
          {journey.originText} → {journey.destText}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Card className="p-4 text-center shadow-[var(--shadow-card)]">
          <div className="font-serif text-3xl font-bold tracking-tight">
            {totalMin} min
          </div>
          <div className="eyebrow mt-1 text-[10px] text-ripple-muted">
            Total time
          </div>
        </Card>
        <Card className="p-4 text-center shadow-[var(--shadow-card)]">
          <div className="font-serif text-3xl font-bold tracking-tight">
            {(distanceM / 1000).toFixed(1)} km
          </div>
          <div className="eyebrow mt-1 text-[10px] text-ripple-muted">
            Distance
          </div>
        </Card>
      </div>

      <Card className="mt-3 p-4">
        <div className="flex flex-col gap-2">
          {legs.map((l, i) => {
            const instr = instruction(l);
            return (
              <div key={i} className="flex items-center gap-2.5 text-sm">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-white"
                  style={{
                    background:
                      l.type === "walk"
                        ? "#22c55e"
                        : l.type === "cycle"
                          ? "#0ea5e9"
                          : l.type === "bus"
                            ? "#3b82f6"
                            : lineColor(l.lineCode),
                  }}
                >
                  {legIcon(l.type, 14)}
                </span>
                <span className="flex-1">{instr.title}</span>
                <span className="data-voice text-xs text-ripple-muted">
                  {fmtDuration(l.duration)}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mt-3 flex items-center gap-2 p-4 text-ok">
        <span className="text-lg">🌱</span>
        <span className="text-sm font-medium">
          {co2Kg.toFixed(2)} kg CO₂ — added to your Impact
        </span>
      </Card>

      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => toast.info("Sharing comes soon.")}
        >
          <Share2 size={15} /> Share
        </Button>
        <Button variant="accent" className="flex-1" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
