import { useEffect, useRef, useMemo, type ReactNode } from "react";
import { useLocation, Link } from "wouter";
import {
  Footprints,
  TrainFront,
  Bus,
  Bike,
  Navigation,
  X,
  ChevronLeft,
  ChevronDown,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Undo2,
  MapPin,
  Check,
  Share2,
  DoorOpen,
  Clock,
  TriangleAlert,
  RotateCcw,
  Loader2,
  Leaf,
  Umbrella,
  CloudRain,
  TreePine,
  ParkingSquare,
} from "lucide-react";
import { surfaceGuide } from "../lib/surfaceGuide.js";
import { useState } from "react";
import type { WalkStep } from "@shared/types.js";
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
const GPS_FRESH_MS = 45_000; // beyond this a fix is stale: count down by the clock instead

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

/**
 * Minutes left in the journey, measured from HERE rather than from the top of
 * the current leg. This used to sum whole leg durations, so the countdown only
 * moved when you advanced a leg — halfway through an 11-minute bus ride with a
 * 3-minute walk to follow, it still claimed 14 minutes.
 */
export function remainingMinutes({
  legs,
  currentLeg,
  remainingM,
  gpsFixedAt,
  legStartedAt,
  nowMs,
}: {
  legs: RouteLeg[];
  currentLeg: number;
  /** Distance still to cover on the current leg (clamped to its length). */
  remainingM: number;
  /** When the position fix was taken, or null if there's no fix. */
  gpsFixedAt: number | null;
  legStartedAt: number;
  nowMs: number;
}): number {
  const leg = legs[currentLeg];
  if (!leg) return 0;
  const gpsFresh = gpsFixedAt != null && nowMs - gpsFixedAt < GPS_FRESH_MS;
  const legRemainingS =
    gpsFresh && leg.distance > 0
      ? // Fresh fix: pro-rate by how much of the leg is still ahead of you.
        leg.duration * Math.min(1, Math.max(0, remainingM / leg.distance))
      : // Stale/absent fix (underground, backgrounded): fall back to the clock
        // since this leg began, so the countdown still ticks.
        Math.max(0, leg.duration - (nowMs - legStartedAt) / 1000);
  // Later legs carry their ride time PLUS the scheduled gap before boarding —
  // otherwise the header quietly dropped every transfer wait and undercut the
  // total the user picked the route on (36 min plan showing as 25 min left).
  let later = 0;
  for (let i = currentLeg + 1; i < legs.length; i++) {
    const prev = legs[i - 1];
    const wait =
      legs[i].startTimeMs != null && prev.endTimeMs != null
        ? Math.max(0, (legs[i].startTimeMs! - prev.endTimeMs!) / 1000)
        : 0;
    later += legs[i].duration + wait;
  }
  return Math.round((legRemainingS + later) / 60);
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
  // Road jams on the bus you're riding (or about to board): re-checked live, so
  // an incident that appeared after planning still surfaces.
  const roadLeg = busLeg;
  const legTraffic = trpc.pulse.legTraffic.useQuery(
    roadLeg
      ? {
          polyline: roadLeg.polyline,
          start: roadLeg.startPoint,
          end: roadLeg.endPoint,
        }
      : (undefined as never),
    { enabled: active && !!roadLeg, refetchInterval: 120_000 },
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
  // One unified live mode: navigation always shows; the whole journey is an
  // inline expander under it (no step-by-step ↔ full-route toggle, no camera
  // swap — the map always follows the current leg).
  const [routeOpen, setRouteOpen] = useState(false);
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

  // Snap the dot to the route line so it rides the path instead of floating on
  // noisy GPS — but only when we're basically on the line (real drift shows raw,
  // and WalkGuidance still flags it off the RAW position). The tilt then faces
  // down the path (segment tangent), not at the far endpoint.
  const legPath: [number, number][] = leg
    ? leg.polyline
      ? decodePolyline(leg.polyline)
      : [
          [leg.startPoint.lat, leg.startPoint.lng],
          [leg.endPoint.lat, leg.endPoint.lng],
        ]
    : [];
  const snap =
    geo.position && (leg?.type === "walk" || leg?.type === "cycle")
      ? snapToPath(geo.position, legPath)
      : null;
  const onPath = !!snap && snap.distance <= SNAP_MAX_M;
  const displayPosition = onPath && snap ? snap.point : geo.position;

  // Walk/cycle legs get a tilted, heading-up 3D navigation view that follows
  // you — but only in the "current leg" camera mode; the "full route" mode
  // fits the whole remaining journey instead.
  const walkCamera:
    | { pitch: number; bearing: number; follow: LatLng; followZoom: number }
    | Record<string, never> =
    leg?.type === "walk" || leg?.type === "cycle"
      ? {
          pitch: 55,
          bearing:
            onPath && snap
              ? snap.bearing
              : geo.position
                ? bearingBetween(geo.position, leg.endPoint)
                : bearingBetween(leg.startPoint, leg.endPoint),
          follow: displayPosition ?? leg.startPoint,
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

  const nowMs = Date.now();
  const remainingMin = remainingMinutes({
    legs,
    currentLeg: journey.currentLeg,
    remainingM,
    gpsFixedAt: geo.updatedAt,
    legStartedAt: journey.legStartedAt,
    nowMs,
  });
  // The watched bus looks gone if its ETA has already passed.
  const busDeparted =
    busLeg != null && busEta != null && new Date(busEta).getTime() < Date.now();

  // Journey-wide ETA (§3.1): plan minutes from the current leg onward, projected
  // onto the wall clock. Refreshed by the 30s tick and by GPS updates.
  const arrivalMs = Date.now() + remainingMin * 60_000;
  const arrivalClock = fmtTime(new Date(arrivalMs).toISOString());

  // Live risk (§4): re-evaluate the catch/disruption risk against live data for
  // the leg in progress (and the bus/MRT one leg ahead).
  const risk = liveRisk({
    leg,
    busLeg,
    busMin,
    remainingM,
    mrtDisrupted,
    traffic: legTraffic.data ?? [],
  });

  // Camera (§2): the map always follows the current leg — the tilted walk/cycle
  // follow above, or a fit to the current transit leg here. (No full-route
  // camera mode; the whole journey is a panel expander instead.)
  const fitPoints: LatLng[] | null =
    leg && leg.type !== "walk" && leg.type !== "cycle"
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
      // Itineraries come back fastest-first. Only offer one that's actually a
      // sensible alternative — near last service OneMap returns "wait until the
      // first morning bus" plans (8h+), which are never a "better route". Allow
      // some slowdown over the optimistic original remaining (you may have just
      // missed a connection), but reject anything dramatically slower.
      const best = res.plan.itineraries[0];
      const origSec = remainingMin * 60;
      const capSec = Math.max(origSec * 2, origSec + 30 * 60);
      if (best && best.duration <= capSec) {
        setReroute({ itinerary: best, start });
      } else if (best) {
        toast.error(
          "No sensible route from here right now — services may have ended for the night.",
        );
      } else {
        toast.error("No alternative route found from here.");
      }
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
          <span className="text-ripple-muted">
            {" "}
            · {fmtDuration(remainingMin * 60)} left
          </span>
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
          livePosition={displayPosition}
          heading={onPath && snap ? snap.bearing : null}
          fitPoints={fitPoints}
          liveJourney
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
        {/* One unified live view: the navigation guidance for the leg in
            progress (turn-by-turn for a walk/cycle — including a transit access
            walk — plus current/next stepper and the single most decision-
            relevant live fact), then the whole journey folded into an expander. */}
        {leg && (
          <LegHero leg={leg} remainingM={remainingM} legColor={legColor} />
        )}

        {leg && (leg.type === "walk" || leg.type === "cycle") && (
          <WalkGuidance leg={leg} position={geo.position} />
        )}

        {/* One contextual comfort layer, condition/proximity-gated: walk shelter
            when it's wet, cycle park-connector entrance/exit as you near it. */}
        {leg && (leg.type === "walk" || leg.type === "cycle") && leg.surface && (
          <SurfaceInsight leg={leg} position={geo.position} />
        )}

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

        {/* Full route — the whole journey, in place. Replaces the old separate
            "full route" mode + its camera; tap to expand, no view switch. */}
        {total > 1 && (
          <div className="mt-3 border-t border-[var(--border)] pt-2.5">
            <button
              type="button"
              onClick={() => setRouteOpen((o) => !o)}
              aria-expanded={routeOpen}
              className="flex w-full items-center justify-between hover:opacity-80"
            >
              <span className="eyebrow text-ripple-muted">
                Full route · {total} legs
              </span>
              <ChevronDown
                size={15}
                className={cn(
                  "text-ripple-muted transition-transform",
                  routeOpen && "rotate-180",
                )}
              />
            </button>
            {routeOpen && (
              <div className="mt-2.5">
                <FullStepper legs={legs} current={journey.currentLeg} />
              </div>
            )}
          </div>
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
        {(busLeg || mrtLeg) && !risk && (
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
        title="Alternative from here"
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
              Your original plan had about {fmtDuration(remainingMin * 60)} left.
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
  traffic,
}: {
  leg: RouteLeg | undefined;
  busLeg: RouteLeg | undefined;
  busMin: number | null;
  remainingM: number;
  mrtDisrupted: { lineCode: string; status: string; message?: string } | undefined;
  /** Live road incidents matched to the bus leg's path. */
  traffic: { severe: boolean; label: string }[];
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
  // Road jam on the bus's path. Severe types (accident, heavy traffic, road
  // block) go red; roadworks and the like stay amber.
  if (traffic.length) {
    const worst = traffic.find((t) => t.severe) ?? traffic[0];
    const more = traffic.length - 1;
    return {
      level: worst.severe ? "miss" : "tight",
      headline: worst.label,
      caption: more
        ? `on your bus route · ${more} more incident${more > 1 ? "s" : ""} ahead`
        : "on your bus route — expect delays",
    };
  }
  return null;
}

/** Current leg: full-size filled node (with a "you are here" halo), title,
 *  from/to detail, exit badge (MRT), and distance · duration. */
const TURN_ICON: Record<WalkStep["turn"], typeof ArrowUp> = {
  straight: ArrowUp,
  left: CornerUpLeft,
  right: CornerUpRight,
  "slight-left": ArrowUpLeft,
  "slight-right": ArrowUpRight,
  "sharp-left": ArrowLeft,
  "sharp-right": ArrowRight,
  uturn: Undo2,
  arrive: MapPin,
};

/** Decode an encoded polyline (precision 5) into [lat, lng] pairs. */
function decodePolyline(str: string): [number, number][] {
  let i = 0,
    lat = 0,
    lng = 0;
  const pts: [number, number][] = [];
  while (i < str.length) {
    let b,
      shift = 0,
      result = 0;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

/** Shortest distance (m) from a point to a polyline (min over its segments). */
function distanceToPath(p: LatLng, path: [number, number][]): number {
  if (path.length === 0) return Infinity;
  const R = 6371000;
  const rad = Math.PI / 180;
  const latRef = p.lat * rad;
  // Local metres relative to p (equirectangular — fine at street scale).
  const xy = (lat: number, lng: number): [number, number] => [
    (lng - p.lng) * rad * Math.cos(latRef) * R,
    (lat - p.lat) * rad * R,
  ];
  if (path.length === 1) {
    const [x, y] = xy(path[0][0], path[0][1]);
    return Math.hypot(x, y);
  }
  let min = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = xy(path[i - 1][0], path[i - 1][1]);
    const [bx, by] = xy(path[i][0], path[i][1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Project `p` onto the route polyline and return the closest point ON the line,
 * its distance, and the bearing of that segment (the travel direction there).
 * Used to snap the live dot to the path so it rides the route instead of
 * floating on noisy GPS, and to face the tilted 3D view DOWN the path (the
 * segment tangent) rather than at the far endpoint. `path` is [lat, lng][].
 */
function snapToPath(
  p: LatLng,
  path: [number, number][],
): { point: LatLng; distance: number; bearing: number } | null {
  if (path.length < 2) return null;
  const R = 6371000;
  const rad = Math.PI / 180;
  const latRef = p.lat * rad;
  const xy = (lat: number, lng: number): [number, number] => [
    (lng - p.lng) * rad * Math.cos(latRef) * R,
    (lat - p.lat) * rad * R,
  ];
  let best = { d: Infinity, seg: 1, t: 0 };
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = xy(path[i - 1][0], path[i - 1][1]);
    const [bx, by] = xy(path[i][0], path[i][1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = { d, seg: i, t };
  }
  const a = path[best.seg - 1];
  const b = path[best.seg];
  return {
    point: {
      lat: a[0] + best.t * (b[0] - a[0]),
      lng: a[1] + best.t * (b[1] - a[1]),
    },
    distance: best.d,
    bearing: bearingBetween(
      { lat: a[0], lng: a[1] },
      { lat: b[0], lng: b[1] },
    ),
  };
}

const SNAP_MAX_M = 32; // snap the dot to the line only when basically on it
const OFF_ROUTE_M = 70; // drift beyond this → "off route"
const ON_ROUTE_M = 45; // ...come back within this to clear it (hysteresis)

// ── The unified live-insight vocabulary ───────────────────────
// One tinted row shared by every live signal — guidance, live status, risk, and
// (next) shelter / bike-stand / PCN alerts. Each future contextual alert is just
// "render one more <InsightCard>", so they all read as one language. Tones reuse
// the app's theme-aware wayfinding/status tokens (info=brand cyan, blue=bus,
// good/amber/red = the StatusBadge vocabulary) so they hold contrast in both
// themes without hard-coded hex.
type InsightTone = "good" | "info" | "amber" | "blue" | "red";
const INSIGHT_TONE: Record<
  InsightTone,
  { wrap: string; icon: string; eyebrow: string }
> = {
  good: { wrap: "border-ok/30 bg-ok/10", icon: "bg-ok", eyebrow: "text-ok" },
  info: {
    wrap: "border-brand/30 bg-brand/10",
    icon: "bg-brand",
    eyebrow: "text-brand",
  },
  amber: {
    wrap: "border-warning/40 bg-warning/10",
    icon: "bg-warning",
    eyebrow: "text-warning",
  },
  blue: { wrap: "border-bus/30 bg-bus/10", icon: "bg-bus", eyebrow: "text-bus" },
  red: {
    wrap: "border-error/30 bg-error/10",
    icon: "bg-error",
    eyebrow: "text-error",
  },
};

/**
 * A tone-tinted insight row: a circle icon in the tone colour, a mono eyebrow
 * label, and a bold one-line title (plus an optional mono sub-line). The single
 * building block for every live insight in the sheet — reused so guidance, live
 * status, risk and future shelter/bike/PCN alerts share one visual grammar.
 */
function InsightCard({
  tone,
  eyebrow,
  title,
  sub,
  Icon,
  onClick,
  className,
}: {
  tone: InsightTone;
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  Icon: typeof ArrowUp;
  onClick?: () => void;
  className?: string;
}) {
  const t = INSIGHT_TONE[tone];
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left",
        t.wrap,
        onClick && "transition-opacity hover:opacity-90",
        className,
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white",
          t.icon,
        )}
      >
        <Icon size={20} strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("eyebrow text-[10px]", t.eyebrow)}>{eyebrow}</div>
        <div className="truncate text-sm font-semibold text-[var(--fg)]">
          {title}
        </div>
        {sub != null && (
          <div className="data-voice mt-0.5 truncate text-[11px] text-ripple-muted">
            {sub}
          </div>
        )}
      </div>
    </Wrapper>
  );
}

/** Short mode label for the leg hero eyebrow — carries the bus number / line
 *  so the destination line below can stay purely about where you're headed. */
function modeWord(leg: RouteLeg): string {
  if (leg.type === "walk") return "Walk";
  if (leg.type === "cycle") return "Cycle";
  if (leg.type === "bus") return `Bus ${leg.busNo ?? ""}`.trim();
  return `${leg.lineCode ? leg.lineCode + " line" : lineName(leg.lineCode)}`;
}

/**
 * The current-leg hero — mirrors the plan-route walk/cycle card: mono eyebrow
 * ("Current leg · Walk"), a serif time hero paired with the mono distance still
 * to cover, then the destination. The mode icon sits in a haloed node so the
 * card still anchors the "you are here" step. shadow-card lifts it above the
 * flatter insight rows.
 */
function LegHero({
  leg,
  remainingM,
  legColor,
}: {
  leg: RouteLeg;
  remainingM: number;
  legColor: string;
}) {
  const onFoot = leg.type === "walk" || leg.type === "cycle";
  const instr = instruction(leg);
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-card)]">
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white"
        style={{ background: legColor, boxShadow: `0 0 0 5px ${legColor}33` }}
      >
        {legIcon(leg.type, 22)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="eyebrow text-[10px] text-ripple-muted">
          Current leg · {modeWord(leg)}
        </div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="font-serif text-[26px] font-bold leading-none tracking-tight">
            {fmtDuration(leg.duration)}
          </span>
          {onFoot && (
            <span className="data-voice text-sm font-semibold text-ripple-muted">
              {fmtDistance(remainingM)}
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-sm text-ripple-muted">
          {instr.detail}
        </div>
        {leg.type === "mrt" && leg.exitName && (
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
            <DoorOpen size={12} /> {leg.exitName}
            {leg.exitDistanceM != null && ` · ${fmtDistance(leg.exitDistanceM)}`}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Live walk/cycle guidance. Rather than a jumpy distance-to-next-turn (which
 * flickers even when you're on the right path), this keeps the focus on ONE
 * question: are you on your route? It flags when you drift too far from the
 * leg's path and otherwise shows the next manoeuvre direction. Works for any
 * walk/cycle leg — a full walk or a transit access walk.
 */
function WalkGuidance({
  leg,
  position,
}: {
  leg: RouteLeg;
  position: LatLng | null;
}) {
  const q = trpc.onemap.walkSteps.useQuery(
    {
      start: leg.startPoint,
      end: leg.endPoint,
      mode: leg.type === "cycle" ? "cycle" : "walk",
    },
    { staleTime: Infinity, retry: 1 },
  );
  const steps = q.data ?? [];

  const path = useMemo<[number, number][]>(
    () =>
      leg.polyline
        ? decodePolyline(leg.polyline)
        : [
            [leg.startPoint.lat, leg.startPoint.lng],
            [leg.endPoint.lat, leg.endPoint.lng],
          ],
    [leg.polyline, leg.startPoint, leg.endPoint],
  );

  // The next manoeuvre to hint (no distance), advanced by proximity to turns.
  const [seg, setSeg] = useState(0);
  useEffect(() => setSeg(0), [leg.startPoint.lat, leg.startPoint.lng]);
  useEffect(() => {
    if (!position || steps.length < 2) return;
    setSeg((i) => {
      let n = i;
      while (n + 1 < steps.length - 1 && haversineMeters(position, steps[n + 1].point) < 22)
        n++;
      return n;
    });
  }, [position, steps]);

  // On-route vs drifted, with hysteresis so it doesn't chatter at the boundary.
  const drift = position ? distanceToPath(position, path) : null;
  const [off, setOff] = useState(false);
  useEffect(() => {
    if (drift == null) return;
    setOff((prev) => (prev ? drift > ON_ROUTE_M : drift > OFF_ROUTE_M));
  }, [drift]);

  const nextTurn = steps[Math.min(seg + 1, steps.length - 1)];
  const TurnIcon = nextTurn ? TURN_ICON[nextTurn.turn] : Navigation;

  if (off)
    return (
      <InsightCard
        tone="amber"
        eyebrow="Off route"
        title={`${drift != null ? `~${fmtDistance(Math.round(drift))} away — ` : ""}head back to the path`}
        Icon={TriangleAlert}
        className="mb-3"
      />
    );
  return (
    <InsightCard
      tone="good"
      eyebrow="On route"
      title={nextTurn ? nextTurn.instruction : "Continue on your path"}
      sub={q.isLoading ? "finding your next turn…" : undefined}
      Icon={TurnIcon}
      className="mb-3"
    />
  );
}

const PCN_PROXIMITY_M = 120; // surface the cycle PCN card only when a change is near
const BIKE_NEAR_M = 220; // start pointing out end-of-ride bike parking this close

/** "Ulu Pandan Park Connector" → "Ulu Pandan PC" so it fits one line. */
function shortPcn(name: string): string {
  return name.replace(/\bpark connector\b/i, "PC").trim();
}

/**
 * The single contextual comfort layer for a walk/cycle leg, derived from the
 * leg's surface spans + live position. WALK is rain-gated: only when it's wet
 * does the shelter card appear ("Covered for the next 180 m" / "90 m to your
 * next cover"). CYCLE is proximity-triggered: a park-connector entrance/exit
 * card surfaces only as you approach it, then clears — impressionable, never a
 * persistent list. Renders one InsightCard, or nothing.
 */
function SurfaceInsight({
  leg,
  position,
}: {
  leg: RouteLeg;
  position: LatLng | null;
}) {
  // Rain gate for the walk shelter card — is it wet where you are right now?
  // Keyed on the (stable) leg start so it doesn't refetch on every GPS move.
  const wx = trpc.weather.current.useQuery(
    { lat: leg.startPoint.lat, lng: leg.startPoint.lng },
    { enabled: leg.type === "walk", staleTime: 5 * 60_000, retry: 1 },
  );
  // Bike parking near where this cycle ride ends (asked once, as you near it).
  const bike = trpc.active.bikeParking.useQuery(
    { point: leg.endPoint },
    { enabled: leg.type === "cycle", staleTime: 30 * 60_000, retry: 1 },
  );

  if (!position || !leg.surface) return null;
  const g = surfaceGuide(position, leg.surface);
  if (!g || g.offRoute) return null;

  if (leg.type === "walk") {
    // Dry: no shelter card at all — cover only matters when you'd get wet.
    if (!wx.data?.wet) return null;
    if (g.currentClass === "shelter") {
      return (
        <InsightCard
          tone="blue"
          eyebrow="Sheltered"
          title={
            g.currentRunToEnd
              ? "Covered the rest of the way"
              : `Covered for the next ${fmtDistance(g.currentRunAheadM)}`
          }
          Icon={Umbrella}
          className="mt-2.5"
        />
      );
    }
    return (
      <InsightCard
        tone="amber"
        eyebrow="In the open"
        title={
          g.toShelterM != null
            ? `${fmtDistance(g.toShelterM)} to your next cover`
            : `No cover ahead — ${fmtDistance(g.currentRunAheadM)} in the open`
        }
        Icon={CloudRain}
        className="mt-2.5"
      />
    );
  }

  // Cycle, nearing the end of the ride: point out where to park. Takes
  // precedence over a PCN boundary — arriving is the more useful cue now.
  const stand = bike.data?.stands[0];
  if (stand && haversineMeters(position, leg.endPoint) <= BIKE_NEAR_M) {
    const aheadM = Math.round(haversineMeters(position, stand));
    return (
      <InsightCard
        tone="good"
        eyebrow="Bike parking"
        title={`${stand.covered ? "Sheltered rack" : "Bike rack"} ${fmtDistance(aheadM)} ahead — at your stop`}
        sub={stand.capacity ? `${stand.capacity} spaces · OSM` : "OSM"}
        Icon={ParkingSquare}
        className="mt-2.5"
      />
    );
  }

  // Otherwise only speak up near a park-connector boundary.
  const near =
    g.nextChange && g.nextChange.distanceM <= PCN_PROXIMITY_M
      ? g.nextChange
      : null;
  if (!near) return null;
  if (near.toClass === "pcn")
    return (
      <InsightCard
        tone="good"
        eyebrow="Park connector"
        title={
          near.toName
            ? `Joining ${shortPcn(near.toName)} in ${fmtDistance(near.distanceM)}`
            : `Joining the park connector in ${fmtDistance(near.distanceM)}`
        }
        Icon={TreePine}
        className="mt-2.5"
      />
    );
  if (near.fromClass === "pcn" && near.toClass === "plain")
    return (
      <InsightCard
        tone="amber"
        eyebrow="Road ahead"
        title={`Leaving the connector in ${fmtDistance(near.distanceM)}`}
        Icon={CornerUpRight}
        className="mt-2.5"
      />
    );
  return null;
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
    <InsightCard
      tone="blue"
      eyebrow="Live arrival"
      title={`Bus ${busLeg.busNo} ${busMin === 0 ? "arriving now" : `arrives in ${busMin} min`}`}
      sub={`${busLeg.startBusStop ? `at ${busLeg.startBusStop} · ` : ""}live`}
      Icon={Clock}
      className="mt-2.5"
    />
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
  return (
    <div className="mt-2.5">
      {/* The escalated state speaks the same InsightCard language as the calm
          live status it replaces — only the tone (red/amber) and the attached
          re-route CTA below mark it as urgent. */}
      <InsightCard
        tone={miss ? "red" : "amber"}
        eyebrow={miss ? "Miss risk" : "Running tight"}
        title={risk.headline}
        sub={risk.caption}
        Icon={TriangleAlert}
      />
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
