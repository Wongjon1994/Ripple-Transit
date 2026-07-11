import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc.js";
import { SearchPanel, type Place } from "../components/SearchPanel.js";
import { RouteResultsPanel } from "../components/RouteResultsPanel.js";
import { MapView } from "../components/MapView.js";
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
  const utils = trpc.useUtils();

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

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="z-10 flex w-full flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--bg)] md:w-[380px]">
        <div className="p-4">
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
          />
        </div>

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
              />
            )}
          </div>
        )}
      </aside>

      {/* Map */}
      <main className="relative min-h-[300px] flex-1">
        <MapView
          origin={from}
          destination={to}
          itinerary={itineraries[selected] ?? null}
        />
      </main>
    </div>
  );
}
