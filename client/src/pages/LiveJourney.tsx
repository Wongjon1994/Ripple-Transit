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
} from "lucide-react";
import { toast } from "sonner";
import { useJourney, type ActiveJourney } from "../lib/journey.js";
import { useGeolocation } from "../lib/useGeolocation.js";
import { useAuth } from "../lib/auth.js";
import { trpc } from "../lib/trpc.js";
import { MapView } from "../components/MapView.js";
import { Button, Card } from "../components/ui.js";
import { lineColor, lineName } from "../lib/transit.js";
import { fmtDistance, fmtDuration, haversineMeters, cn } from "../lib/utils.js";
import type { RouteLeg } from "@shared/types.js";

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
  const { journey, advance, back, end } = useJourney();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const active = !!journey && journey.status === "active";
  const geo = useGeolocation(active);
  const logged = useRef(false);
  const logTrip = trpc.sustainability.logTrip.useMutation();

  const legs = journey?.itinerary.legs ?? [];
  const leg = journey ? legs[journey.currentLeg] : undefined;

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

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <MapView
          origin={journey.origin}
          destination={journey.destination}
          itinerary={journey.itinerary}
          livePosition={geo.position}
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
      </div>
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
