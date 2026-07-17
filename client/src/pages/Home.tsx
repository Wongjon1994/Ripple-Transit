import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { BusFront, Footprints, Bike } from "lucide-react";
import { trpc } from "../lib/trpc.js";
import { SearchPanel, MAX_STOPS, type Place } from "../components/SearchPanel.js";
import { NearestPanel } from "../components/NearestPanel.js";
import { RouteResultsPanel } from "../components/RouteResultsPanel.js";
import { ActiveRoutePanel } from "../components/ActiveRoutePanel.js";
import { MapView } from "../components/MapView.js";
import { MrtStatus } from "../components/MrtStatus.js";
import { useJourney } from "../lib/journey.js";
import { useLocation } from "wouter";
import { cn } from "../lib/utils.js";
import type {
  ActiveMode,
  ActiveVariant,
  Itinerary,
  LatLng,
  NearestBusStop,
  NearestResult,
} from "@shared/types.js";

type ModeTab = "transit" | ActiveMode;

const MODE_TABS: { id: ModeTab; label: string; Icon: typeof BusFront }[] = [
  { id: "transit", label: "Transit", Icon: BusFront },
  { id: "walk", label: "Walk", Icon: Footprints },
  { id: "cycle", label: "Cycle", Icon: Bike },
];

function nowParts() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

/** One destination field: typed text + resolved coordinates (if picked). */
interface Stop {
  text: string;
  point: LatLng | null;
}

export function Home() {
  const initial = useMemo(nowParts, []);
  const [fromText, setFromText] = useState("");
  const [from, setFrom] = useState<LatLng | null>(null);
  // Destinations in visit order — 1 to 5 stops; the last one is "To".
  const [stops, setStops] = useState<Stop[]>([{ text: "", point: null }]);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  // Depart time follows the device clock until the user edits it manually
  // (editing means they're planning a future trip).
  const [timeIsAuto, setTimeIsAuto] = useState(true);
  const [selected, setSelected] = useState(0);
  // Results mode: Transit | Walk | Cycle (all support multi-stop journeys).
  const [modeTab, setModeTab] = useState<ModeTab>("transit");
  // Selected variant within the active tab (fastest / sheltered / PCN).
  const [activeSel, setActiveSel] = useState(0);

  const [routeParams, setRouteParams] = useState<{
    points: LatLng[]; // origin first, then each stop in order
    date: string;
    time: string;
  } | null>(null);
  const [resolving, setResolving] = useState(false);

  // Mobile bottom sheet: three snap heights (fraction of viewport). Peek shows
  // just the search form so the map gets most of the screen; expands to half
  // once results arrive, and can be dragged to full via the grab handle.
  const SNAPS = [0.42, 0.62, 0.9];
  const [snapIdx, setSnapIdx] = useState(0);
  const [dragH, setDragH] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const utils = trpc.useUtils();
  const journeyCtx = useJourney();
  const [, navigate] = useLocation();

  function handleStartJourney() {
    const it = itineraries[selected];
    if (!it || !routeParams) return;
    journeyCtx.start({
      itinerary: it,
      originText: fromText,
      destText: stops[stops.length - 1]?.text ?? "",
      origin: routeParams.points[0],
      destination: routeParams.points[routeParams.points.length - 1],
    });
    navigate("/journey");
  }

  // Resolve a text field to coordinates: use the picked suggestion if we have
  // one, otherwise geocode the typed text via OneMap (first match wins).
  async function resolvePoint(
    picked: LatLng | null,
    text: string,
  ): Promise<LatLng | null> {
    if (picked) return picked;
    if (!text.trim()) return null;
    const res = await utils.onemap.search.fetch({ q: text });
    const first = res.results[0];
    return first ? { lat: first.lat, lng: first.lng } : null;
  }

  // Single destination uses the multi-option `route`; 2+ stops use the
  // stitched `multiRoute` (one sequential journey, live data on segment 1).
  const isMulti = (routeParams?.points.length ?? 0) > 2;

  const singleRoute = trpc.onemap.route.useQuery(
    routeParams
      ? {
          start: routeParams.points[0],
          end: routeParams.points[1],
          mode: "TRANSIT" as const,
          date: routeParams.date,
          time: routeParams.time,
        }
      : (undefined as never),
    {
      enabled: !!routeParams && !isMulti,
      retry: false,
      // The depart time ticks with the clock — keep showing the previous
      // results while the refreshed ranking loads (no flicker).
      placeholderData: keepPreviousData,
    },
  );
  const multiRoute = trpc.onemap.multiRoute.useQuery(
    routeParams
      ? {
          points: routeParams.points,
          date: routeParams.date,
          time: routeParams.time,
        }
      : (undefined as never),
    {
      enabled: !!routeParams && isMulti,
      retry: false,
      placeholderData: keepPreviousData,
    },
  );
  const route = isMulti ? multiRoute : singleRoute;

  const itineraries = route.data?.plan.itineraries ?? [];

  // Taxi estimates are point-to-point — hidden for multi-stop journeys.
  const taxi = trpc.taxi.estimate.useQuery(
    routeParams
      ? {
          origin: routeParams.points[0],
          destination: routeParams.points[routeParams.points.length - 1],
        }
      : (undefined as never),
    { enabled: !!routeParams && !isMulti, retry: false, staleTime: 60_000 },
  );

  // Walk & Cycle tabs (Phase 14): real alternate paths per journey — fastest /
  // most sheltered (walk) / PCN scenic — for the full multi-stop sequence.
  const active = trpc.active.routes.useQuery(
    routeParams ? { points: routeParams.points } : (undefined as never),
    {
      enabled: !!routeParams,
      retry: false,
      staleTime: 120_000,
      placeholderData: keepPreviousData,
    },
  );

  const shownTab: ModeTab = modeTab;
  // Search identity — §9 collapse-by-default resets expansion on a new search
  // (but NOT on the minute-tick refetches, which only change date/time).
  const collapseKey = routeParams
    ? routeParams.points
        .map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
        .join("|")
    : "";
  const selectedVariant: ActiveVariant | null =
    shownTab === "transit"
      ? null
      : (active.data?.[shownTab]?.variants[
          Math.min(activeSel, (active.data?.[shownTab]?.variants.length ?? 1) - 1)
        ] ?? null);

  // Synthetic itinerary for the selected variant — one leg per stop-to-stop
  // segment, so the map, via dividers and the live-journey companion all work
  // exactly as they do for transit.
  const activeItinerary = useMemo((): Itinerary | null => {
    if (shownTab === "transit" || !routeParams || !selectedVariant) return null;
    const pts = routeParams.points;
    return {
      duration: selectedVariant.durationS,
      fare: 0,
      transfers: 0,
      co2Grams: 0,
      co2SavedGrams: active.data?.co2SavedGrams,
      legs: selectedVariant.segments.map((s, i) => ({
        type: shownTab,
        startPoint: pts[i],
        endPoint: pts[i + 1],
        duration: s.durationS,
        distance: s.distanceM,
        polyline: s.polyline,
        toName: stops[i]?.text,
        viaStopIndex: i > 0 ? i : undefined,
      })),
    };
  }, [shownTab, selectedVariant, active.data, routeParams, stops]);

  // "Nearest ___" browse state fed to the map by the NearestPanel.
  const [nearestPois, setNearestPois] = useState<
    { point: LatLng; name: string }[]
  >([]);
  const [showCorridor, setShowCorridor] = useState(false);
  // Walking to a picked bus stop: its live board shows on the Walk tab.
  const [walkTabStopCode, setWalkTabStopCode] = useState<string | null>(null);

  /** Run a fresh point-to-point search with known coordinates. */
  function runDirectSearch(
    points: LatLng[],
    fromLabel: string,
    toLabel: string,
    mode: ModeTab,
  ) {
    setWalkTabStopCode(null);
    setFrom(points[0]);
    setFromText(fromLabel);
    setStops([{ text: toLabel, point: points[points.length - 1] }]);
    setSelected(0);
    setActiveSel(0);
    setModeTab(mode);
    const depart = timeIsAuto ? nowParts() : { date, time };
    setRouteParams({ points, ...depart });
  }

  function handlePickNearYou(myLocation: LatLng, r: NearestResult) {
    // Auto-select the mode tab that won the multi-modal ranking.
    runDirectSearch(
      [myLocation, r.point],
      "Current location",
      r.name,
      r.mode === "transit" ? "transit" : r.mode,
    );
  }

  function handlePickBusStop(myLocation: LatLng, stop: NearestBusStop) {
    // Reaching a nearby stop is inherently a walk — Walk tab + live board.
    runDirectSearch([myLocation, stop.point], "Current location", stop.name, "walk");
    setWalkTabStopCode(stop.code);
  }

  function handlePickNearDestination(r: NearestResult) {
    setStops([{ text: r.name, point: r.point }]);
    setSelected(0);
    setActiveSel(0);
    setModeTab(r.mode === "transit" ? "transit" : r.mode);
    if (from) {
      const depart = timeIsAuto ? nowParts() : { date, time };
      setRouteParams({ points: [from, r.point], ...depart });
    }
  }

  function handlePickAlongTheWay(r: NearestResult) {
    if (!routeParams) return;
    if (stops.length >= MAX_STOPS) {
      toast.error(`Up to ${MAX_STOPS} stops — remove one first.`);
      return;
    }
    // Insert as the FIRST stop (the corridor covers the active leg From → next).
    const pts = routeParams.points;
    setStops((prev) => [{ text: r.name, point: r.point }, ...prev]);
    setSelected(0);
    setActiveSel(0);
    setModeTab("transit");
    const depart = timeIsAuto ? nowParts() : { date, time };
    setRouteParams({ points: [pts[0], r.point, ...pts.slice(1)], ...depart });
  }

  function handleStartActiveJourney(variant: ActiveVariant) {
    void variant; // the selected card is the source of truth
    if (!activeItinerary || !routeParams) return;
    journeyCtx.start({
      itinerary: activeItinerary,
      originText: fromText,
      destText: stops[stops.length - 1]?.text ?? "",
      origin: routeParams.points[0],
      destination: routeParams.points[routeParams.points.length - 1],
    });
    navigate("/journey");
  }

  async function handleSearch() {
    if (!fromText.trim() || stops.some((s) => !s.text.trim())) {
      toast.error("Fill in From and every stop before searching.");
      return;
    }
    setResolving(true);
    try {
      const resolved = await Promise.all([
        resolvePoint(from, fromText),
        ...stops.map((s) => resolvePoint(s.point, s.text)),
      ]);
      if (resolved.some((p) => !p)) {
        toast.error("Couldn’t locate one of those places. Try refining it.");
        return;
      }
      const points = resolved as LatLng[];
      setFrom(points[0]);
      setStops((prev) =>
        prev.map((s, i) => ({ ...s, point: points[i + 1] })),
      );
      setSelected(0);
      setModeTab("transit");
      setActiveSel(0);
      setWalkTabStopCode(null);
      // Auto-synced departures read the clock at the moment of search.
      const depart = timeIsAuto ? nowParts() : { date, time };
      setRouteParams({ points, ...depart });
    } finally {
      setResolving(false);
    }
  }

  // Only offered for a single destination: reverse the trip.
  function handleSwap() {
    const last = stops[stops.length - 1];
    setFrom(last.point);
    setFromText(last.text);
    setStops([{ text: fromText, point: from }]);
  }

  function updateStop(i: number, patch: Partial<Stop>) {
    setStops((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  // Rise to the half snap when results first arrive.
  useEffect(() => {
    if (routeParams) setSnapIdx((i) => Math.max(i, 1));
  }, [routeParams]);

  // While auto-synced, tick Depart date/time with the device clock — and keep
  // an active search's params current too, so results refresh with live
  // timings each minute and re-rank themselves (server sorts fastest-first).
  useEffect(() => {
    if (!timeIsAuto) return;
    const sync = () => {
      const p = nowParts();
      setDate((d) => (d === p.date ? d : p.date));
      setTime((t) => (t === p.time ? t : p.time));
      setRouteParams((prev) =>
        prev && (prev.date !== p.date || prev.time !== p.time)
          ? { ...prev, date: p.date, time: p.time }
          : prev,
      );
    };
    sync();
    const id = window.setInterval(sync, 10_000);
    return () => window.clearInterval(id);
  }, [timeIsAuto]);

  const sheetHeight =
    dragH != null
      ? `${dragH}px`
      : `${Math.round(SNAPS[snapIdx] * 100)}vh`;

  function onHandleDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startY: e.clientY,
      startH: SNAPS[snapIdx] * window.innerHeight,
    };
  }
  function onHandleMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - e.clientY; // up = grow
    const h = dragRef.current.startH + delta;
    const min = SNAPS[0] * window.innerHeight * 0.7;
    const max = SNAPS[SNAPS.length - 1] * window.innerHeight;
    setDragH(Math.max(min, Math.min(max, h)));
  }
  function onHandleUp(e: React.PointerEvent) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (dragH != null) {
      const frac = dragH / window.innerHeight;
      let nearest = 0;
      for (let i = 1; i < SNAPS.length; i++) {
        if (Math.abs(SNAPS[i] - frac) < Math.abs(SNAPS[nearest] - frac))
          nearest = i;
      }
      setSnapIdx(nearest);
    }
    dragRef.current = null;
    setDragH(null);
  }

  return (
    <div className="relative h-full md:flex md:overflow-hidden">
      {/* Panel: bottom sheet on mobile, sidebar on desktop */}
      <aside
        style={isMobile ? { height: sheetHeight } : undefined}
        className="absolute inset-x-0 bottom-0 z-[500] flex flex-col overflow-y-auto overscroll-contain rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg)] shadow-[0_-4px_24px_rgba(0,0,0,0.18)] md:relative md:inset-auto md:z-10 md:h-auto md:w-[380px] md:rounded-none md:border-r md:border-t-0 md:shadow-none"
      >
        {/* Grab handle (mobile only) — drag to resize the sheet */}
        <div
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          className="sticky top-0 z-10 flex shrink-0 cursor-grab touch-none justify-center bg-[var(--bg)] pb-1 pt-2 active:cursor-grabbing md:hidden"
        >
          <span className="h-1 w-10 rounded-full bg-ripple-muted/40" />
        </div>
        <div className="px-4 pb-4 pt-2 md:pt-4">
          <SearchPanel
            fromText={fromText}
            stops={stops}
            onFromText={setFromText}
            onStopText={(i, s) => updateStop(i, { text: s, point: null })}
            onFromSelect={(p) => {
              setFrom(p.point);
              setFromText(p.label);
            }}
            onStopSelect={(i, p) =>
              updateStop(i, { text: p.label, point: p.point })
            }
            onAddStop={() =>
              setStops((prev) => [...prev, { text: "", point: null }])
            }
            onRemoveStop={(i) =>
              setStops((prev) => prev.filter((_, j) => j !== i))
            }
            onSwap={handleSwap}
            date={date}
            time={time}
            onDate={(s) => {
              setDate(s);
              setTimeIsAuto(false);
            }}
            onTime={(s) => {
              setTime(s);
              setTimeIsAuto(false);
            }}
            timeIsAuto={timeIsAuto}
            onResetNow={() => setTimeIsAuto(true)}
            onSearch={handleSearch}
            canSearch={
              !!fromText.trim() && stops.every((s) => !!s.text.trim())
            }
            isSearching={resolving || (route.isFetching && !route.data)}
            onPickSavedLocation={(p) => {
              // Fill From if empty, else the first empty stop, else the last stop.
              if (!fromText.trim()) {
                setFrom(p.point);
                setFromText(p.label);
                return;
              }
              const emptyIdx = stops.findIndex((s) => !s.text.trim());
              const idx = emptyIdx >= 0 ? emptyIdx : stops.length - 1;
              updateStop(idx, { text: p.label, point: p.point });
            }}
            onPickFavourite={(origin, destination) => {
              setFrom(null);
              setFromText(origin);
              setStops([{ text: destination, point: null }]);
            }}
            showShortcuts={!routeParams}
          />
        </div>

        <NearestPanel
          destination={stops[stops.length - 1]?.point ?? null}
          destinationLabel={stops[stops.length - 1]?.text}
          routeFrom={routeParams?.points[0] ?? null}
          routeTo={routeParams?.points[1] ?? null}
          onPickNearYou={handlePickNearYou}
          onPickNearDestination={handlePickNearDestination}
          onPickAlongTheWay={handlePickAlongTheWay}
          onPickBusStop={handlePickBusStop}
          onPoisChange={setNearestPois}
          onCorridorChange={setShowCorridor}
        />

        {routeParams && (
          <div className="border-t border-[var(--border)]">
            {/* Mode tabs — walking & cycling never co-mingle with transit
                options. All three support multi-stop journeys. */}
            <div
              className="flex gap-1 border-b border-[var(--border)] p-2"
              role="tablist"
              aria-label="Travel mode"
            >
              {MODE_TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={shownTab === id}
                  onClick={() => {
                    setModeTab(id);
                    setActiveSel(0);
                  }}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors",
                    shownTab === id
                      ? "bg-brand/10 text-brand"
                      : "text-ripple-muted hover:bg-ripple-muted/10",
                  )}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>

            {shownTab === "transit" ? (
              <>
                {/* §13a: line-status risk is only relevant when transit is the
                    mode being considered — scoped here, not always-visible. */}
                <MrtStatus />
                {route.isError ? (
                <div className="m-4 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
                  Couldn’t calculate a route. {route.error.message}
                </div>
              ) : route.isFetching && itineraries.length === 0 ? (
                <p className="p-4 text-sm text-ripple-muted">
                  Calculating routes…
                </p>
              ) : itineraries.length === 0 ? (
                <p className="p-4 text-sm text-ripple-muted">
                  No transit routes found for this pair.
                </p>
              ) : (
                <RouteResultsPanel
                  itineraries={itineraries}
                  selected={selected}
                  onSelect={setSelected}
                  onSave={() => toast.success("Route saving comes in Phase 11.")}
                  onStartJourney={handleStartJourney}
                  weather={route.data?.weather}
                  carbon={route.data?.carbon}
                  taxi={isMulti ? null : taxi.data}
                  stopLabels={stops.map((s) => s.text)}
                  collapseKey={collapseKey}
                />
              )}
              </>
            ) : (
              <ActiveRoutePanel
                mode={shownTab}
                data={active.data}
                isLoading={active.isLoading}
                selected={activeSel}
                onSelect={setActiveSel}
                onStartJourney={handleStartActiveJourney}
                collapseKey={collapseKey}
                liveBoardStopCode={walkTabStopCode}
              />
            )}
          </div>
        )}
      </aside>

      {/* Map: full-screen background on mobile, right pane on desktop */}
      <main className="absolute inset-0 md:relative md:min-h-0 md:flex-1">
        <MapView
          origin={from}
          destination={stops[stops.length - 1]?.point ?? null}
          waypoints={stops.slice(0, -1).flatMap((s) => (s.point ? [s.point] : []))}
          pois={nearestPois}
          corridor={showCorridor}
          itinerary={
            shownTab === "transit"
              ? (itineraries[selected] ?? null)
              : activeItinerary
          }
        />
      </main>
    </div>
  );
}
