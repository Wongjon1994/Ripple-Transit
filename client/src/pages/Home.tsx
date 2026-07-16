import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc.js";
import { SearchPanel, type Place } from "../components/SearchPanel.js";
import { RouteResultsPanel } from "../components/RouteResultsPanel.js";
import { MapView } from "../components/MapView.js";
import { MrtStatus } from "../components/MrtStatus.js";
import { useJourney } from "../lib/journey.js";
import { useLocation } from "wouter";
import type { LatLng } from "@shared/types.js";

function nowParts() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { date, time };
}

export function Home() {
  const initial = useMemo(nowParts, []);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [from, setFrom] = useState<LatLng | null>(null);
  const [to, setTo] = useState<LatLng | null>(null);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [selected, setSelected] = useState(0);

  const [routeParams, setRouteParams] = useState<{
    start: LatLng;
    end: LatLng;
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
      destText: toText,
      origin: routeParams.start,
      destination: routeParams.end,
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

  const route = trpc.onemap.route.useQuery(
    routeParams
      ? {
          start: routeParams.start,
          end: routeParams.end,
          mode: "TRANSIT" as const,
          date: routeParams.date,
          time: routeParams.time,
        }
      : (undefined as never),
    { enabled: !!routeParams, retry: false },
  );

  const itineraries = route.data?.plan.itineraries ?? [];

  const taxi = trpc.taxi.estimate.useQuery(
    routeParams
      ? { origin: routeParams.start, destination: routeParams.end }
      : (undefined as never),
    { enabled: !!routeParams, retry: false, staleTime: 60_000 },
  );

  async function handleSearch() {
    if (!fromText.trim() || !toText.trim()) {
      toast.error("Enter both a From and To location.");
      return;
    }
    setResolving(true);
    try {
      const [start, end] = await Promise.all([
        resolvePoint(from, fromText),
        resolvePoint(to, toText),
      ]);
      if (!start || !end) {
        toast.error("Couldn’t locate one of those places. Try refining it.");
        return;
      }
      setFrom(start);
      setTo(end);
      setSelected(0);
      setRouteParams({ start, end, date, time });
    } finally {
      setResolving(false);
    }
  }

  function handleSwap() {
    setFrom(to);
    setTo(from);
    setFromText(toText);
    setToText(fromText);
  }

  const selectPlace = (setPoint: (p: LatLng) => void) => (p: Place) =>
    setPoint(p.point);

  // Rise to the half snap when results first arrive.
  useEffect(() => {
    if (routeParams) setSnapIdx((i) => Math.max(i, 1));
  }, [routeParams]);

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
            toText={toText}
            onFromText={setFromText}
            onToText={setToText}
            onFromSelect={(p) => {
              selectPlace(setFrom)(p);
              setFromText(p.label);
            }}
            onToSelect={(p) => {
              selectPlace(setTo)(p);
              setToText(p.label);
            }}
            onSwap={handleSwap}
            date={date}
            time={time}
            onDate={setDate}
            onTime={setTime}
            onSearch={handleSearch}
            canSearch={!!fromText.trim() && !!toText.trim()}
            isSearching={resolving || route.isFetching}
            onPickSavedLocation={(p) => {
              // Fill the first empty field (From, else To).
              if (!fromText.trim()) {
                setFrom(p.point);
                setFromText(p.label);
              } else {
                setTo(p.point);
                setToText(p.label);
              }
            }}
            onPickFavourite={(origin, destination) => {
              setFrom(null);
              setTo(null);
              setFromText(origin);
              setToText(destination);
            }}
            showShortcuts={!routeParams}
          />
        </div>

        <MrtStatus />

        {route.isError && (
          <div className="mx-4 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
            Couldn’t calculate a route. {route.error.message}
          </div>
        )}

        {routeParams && !route.isError && (
          <div className="border-t border-[var(--border)]">
            {route.isFetching && itineraries.length === 0 ? (
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
                taxi={taxi.data}
              />
            )}
          </div>
        )}
      </aside>

      {/* Map: full-screen background on mobile, right pane on desktop */}
      <main className="absolute inset-0 md:relative md:min-h-0 md:flex-1">
        <MapView
          origin={from}
          destination={to}
          itinerary={itineraries[selected] ?? null}
        />
      </main>
    </div>
  );
}
