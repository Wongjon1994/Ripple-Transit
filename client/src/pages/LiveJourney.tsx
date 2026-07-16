import { useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import {
  Footprints,
  TrainFront,
  Bus,
  Navigation,
  X,
  ArrowRight,
  Check,
  Share2,
  DoorOpen,
  Clock,
  TriangleAlert,
  RotateCcw,
  Loader2,
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
  haversineMeters,
  bearingBetween,
  cn,
} from "../lib/utils.js";
import type { RouteLeg, Itinerary, LatLng } from "@shared/types.js";

const ARRIVE_THRESHOLD_M = 35;

function legIcon(type: RouteLeg["type"], size = 20) {
  if (type === "walk") return <Footprints size={size} />;
  if (type === "bus") return <Bus size={size} />;
  return <TrainFront size={size} />;
}

function instruction(leg: RouteLeg): { title: string; detail: string } {
  if (leg.type === "walk")
    return {
      title: "Walk",
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

export function LiveJourney() {
  const { journey, advance, back, end, start: startJourney } = useJourney();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const active = !!journey && journey.status === "active";
  const geo = useGeolocation(active);
  const logged = useRef(false);
  const logTrip = trpc.sustainability.logTrip.useMutation();

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

  // Auto-advance a walk leg once you're within threshold of its end point.
  useEffect(() => {
    if (!journey || !leg || !geo.position || journey.status !== "active") return;
    if (
      leg.type === "walk" &&
      haversineMeters(geo.position, leg.endPoint) < ARRIVE_THRESHOLD_M
    ) {
      advance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.position]);

  // Auto-log the trip to the Impact dashboard on completion (once).
  const completed = journey?.status === "completed";
  useEffect(() => {
    if (!journey || !completed || !user || logged.current) return;
    logged.current = true;
    const distanceM = legs.reduce((s, l) => s + l.distance, 0);
    logTrip.mutate(
      {
        origin: journey.originText || "Origin",
        destination: journey.destText || "Destination",
        mode: "transit",
        co2Grams: journey.itinerary.co2Grams ?? 0,
        savedGrams: 0,
        distanceM: Math.round(distanceM),
      },
      { onSuccess: () => toast.success("Journey logged to your Impact.") },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);

  if (!journey) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="text-sm text-ripple-muted">No active journey.</p>
          <Link
            href="/"
            className="mt-3 inline-block text-sm font-medium text-bus hover:underline"
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
  const instr = leg ? instruction(leg) : { title: "", detail: "" };
  const nextLeg = legs[journey.currentLeg + 1];
  const remainingM =
    geo.position && leg ? haversineMeters(geo.position, leg.endPoint) : leg?.distance ?? 0;
  const legColor =
    leg?.type === "walk"
      ? "#22c55e"
      : leg?.type === "bus"
        ? "#3b82f6"
        : lineColor(leg?.lineCode);

  // Walk legs get a tilted, heading-up 3D navigation view that follows you;
  // transit legs fall back to the flat overview (fit to the whole route).
  const walkCamera:
    | { pitch: number; bearing: number; follow: LatLng; followZoom: number }
    | Record<string, never> =
    leg?.type === "walk"
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
    startJourney({
      itinerary: reroute.itinerary,
      originText: "Current location",
      destText: journey!.destText,
      origin: reroute.start,
      destination: journey!.destination,
    });
    setReroute(null);
    toast.success("Re-routed from your current location.");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <MapView
          origin={journey.origin}
          destination={journey.destination}
          itinerary={journey.itinerary}
          livePosition={geo.position}
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
      <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-2 flex items-center justify-between text-xs text-ripple-muted">
          <span className="font-semibold uppercase tracking-wide">
            Leg {legNum} of {total}
          </span>
          <Button variant="ghost" size="sm" onClick={() => end()}>
            <X size={14} /> End
          </Button>
        </div>

        <div className="flex items-start gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white"
            style={{ background: legColor }}
          >
            {leg && legIcon(leg.type)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">{instr.title}</div>
            <div className="text-sm text-ripple-muted">{instr.detail}</div>
            {leg?.type === "mrt" && leg.exitName && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-mrt/10 px-2 py-0.5 text-xs font-medium text-mrt">
                <DoorOpen size={12} /> {leg.exitName}
                {leg.exitDistanceM != null && ` · ${fmtDistance(leg.exitDistanceM)}`}
              </div>
            )}
            <div className="mt-1 flex items-center gap-1.5 text-xs text-ripple-muted">
              <Navigation size={12} />
              {leg?.type === "walk"
                ? `${fmtDistance(remainingM)} · ~${fmtDuration(leg.duration)}`
                : `${fmtDuration(leg?.duration ?? 0)}`}
            </div>
          </div>
        </div>

        {busLeg && busMin != null && (
          <div className="mt-2.5 flex items-center gap-2 rounded-md bg-bus/10 px-3 py-2 text-xs text-bus">
            <Clock size={14} className="shrink-0" />
            <span>
              <span className="font-semibold">Bus {busLeg.busNo}</span>{" "}
              {busMin === 0 ? "arriving now" : `arrives in ${busMin} min`}
              {busLeg.startBusStop ? ` at ${busLeg.startBusStop}` : ""}
            </span>
          </div>
        )}

        {mrtDisrupted && (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
            <TriangleAlert size={14} className="shrink-0" />
            {mrtDisrupted.lineCode} line {mrtDisrupted.status}
            {mrtDisrupted.message ? `: ${mrtDisrupted.message}` : ""}
          </div>
        )}

        {nextLeg && (
          <div className="mt-2.5 flex items-center gap-2 rounded-md bg-ripple-muted/5 px-3 py-1.5 text-xs text-ripple-muted">
            <span className="font-medium">Next:</span>
            {legIcon(nextLeg.type, 13)}
            {instruction(nextLeg).title}
          </div>
        )}

        <div className="mt-3 flex gap-2">
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

        {(busLeg || mrtLeg) && (
          <Button
            variant="outline"
            className={cn(
              "mt-2 w-full",
              busDeparted && "border-warning/50 text-warning",
            )}
            onClick={handleReroute}
            disabled={rerouteLoading}
          >
            {rerouteLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RotateCcw size={15} />
            )}
            {busDeparted ? "Missed it? Find a better route" : "Re-route from here"}
          </Button>
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
        <h1 className="mt-3 text-2xl font-bold">Journey complete</h1>
        <p className="text-sm text-ripple-muted">
          {journey.originText} → {journey.destText}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold">{totalMin} min</div>
          <div className="text-xs text-ripple-muted">Total time</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold">
            {(distanceM / 1000).toFixed(1)} km
          </div>
          <div className="text-xs text-ripple-muted">Distance</div>
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
                        : l.type === "bus"
                          ? "#3b82f6"
                          : lineColor(l.lineCode),
                  }}
                >
                  {legIcon(l.type, 14)}
                </span>
                <span className="flex-1">{instr.title}</span>
                <span className="text-xs text-ripple-muted">
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
