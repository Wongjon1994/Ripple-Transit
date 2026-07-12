import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowUpDown,
  MapPin,
  Search,
  Loader2,
  Star,
  LocateFixed,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc.js";
import { useAuth } from "../lib/auth.js";
import { Button, Input, Card } from "./ui.js";
import { cn } from "../lib/utils.js";
import type { LatLng, SearchResult } from "@shared/types.js";

export interface Place {
  label: string;
  point: LatLng;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function LocationInput({
  label,
  value,
  onChange,
  onSelect,
  accent,
  labelAction,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onSelect: (place: Place) => void;
  accent: string;
  labelAction?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(value, 250);
  const boxRef = useRef<HTMLDivElement>(null);

  const query = trpc.onemap.search.useQuery(
    { q: debounced },
    { enabled: debounced.trim().length >= 2, staleTime: 60_000 },
  );

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const results: SearchResult[] = query.data?.results ?? [];

  return (
    <div ref={boxRef} className="relative">
      <div className="mb-1 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ripple-muted">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: accent }}
          />
          {label}
        </label>
        {labelAction}
      </div>
      <div className="relative">
        <MapPin
          size={15}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ripple-muted"
        />
        <Input
          className="pl-8"
          placeholder="Search address or place"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          aria-label={label}
        />
        {query.isFetching && (
          <Loader2
            size={15}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-ripple-muted"
          />
        )}
      </div>
      {open && results.length > 0 && (
        <Card className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto p-1 shadow-lg">
          {results.map((r, i) => (
            <button
              key={r.id}
              data-testid={`suggestion-${label.toLowerCase()}-${i}`}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-ripple-muted/10"
              onClick={() => {
                onSelect({ label: r.title, point: { lat: r.lat, lng: r.lng } });
                onChange(r.title);
                setOpen(false);
              }}
            >
              <span className="text-sm font-medium text-[var(--fg)]">
                {r.title}
              </span>
              <span className="line-clamp-1 text-xs text-ripple-muted">
                {r.address}
              </span>
              {r.source === "here" && (
                <span className="text-[10px] font-semibold uppercase text-bus">
                  via HERE
                </span>
              )}
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

export function SearchPanel({
  fromText,
  toText,
  onFromText,
  onToText,
  onFromSelect,
  onToSelect,
  onSwap,
  date,
  time,
  onDate,
  onTime,
  onSearch,
  canSearch,
  isSearching,
  onPickSavedLocation,
  onPickFavourite,
  showShortcuts = true,
}: {
  fromText: string;
  toText: string;
  onFromText: (s: string) => void;
  onToText: (s: string) => void;
  onFromSelect: (p: Place) => void;
  onToSelect: (p: Place) => void;
  onSwap: () => void;
  date: string;
  time: string;
  onDate: (s: string) => void;
  onTime: (s: string) => void;
  onSearch: () => void;
  canSearch: boolean;
  isSearching: boolean;
  onPickSavedLocation: (p: Place) => void;
  onPickFavourite: (origin: string, destination: string) => void;
  showShortcuts?: boolean;
}) {
  const { user } = useAuth();
  const saved = trpc.savedLocations.list.useQuery(undefined, {
    enabled: !!user,
  });
  const favourites = trpc.favouriteRoutes.list.useQuery(undefined, {
    enabled: !!user,
  });

  const utils = trpc.useUtils();
  const [locating, setLocating] = useState(false);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast.error("Geolocation isn't supported by this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        let label = "Current location";
        try {
          const r = await utils.onemap.reverseGeocode.fetch(point);
          if (r.label) label = r.label;
        } catch {
          /* keep the generic label */
        }
        onFromText(label);
        onFromSelect({ label, point });
        setLocating(false);
        toast.success("Using your current location");
      },
      (err) => {
        setLocating(false);
        toast.error(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied."
            : "Couldn't get your location.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex flex-col gap-3">
        <LocationInput
          label="From"
          accent="#3b82f6"
          value={fromText}
          onChange={onFromText}
          onSelect={onFromSelect}
          labelAction={
            <button
              type="button"
              onClick={useCurrentLocation}
              disabled={locating}
              className="flex items-center gap-1 text-xs font-medium text-bus hover:underline disabled:opacity-60"
            >
              {locating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <LocateFixed size={12} />
              )}
              Use my location
            </button>
          }
        />
        <button
          onClick={onSwap}
          aria-label="Swap origin and destination"
          className="absolute right-2 top-[38px] z-10 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1.5 text-ripple-muted hover:text-[var(--fg)]"
        >
          <ArrowUpDown size={14} />
        </button>
        <LocationInput
          label="To"
          accent="#ef4444"
          value={toText}
          onChange={onToText}
          onSelect={onToSelect}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ripple-muted">
            Depart date
          </label>
          <Input
            type="date"
            value={date}
            onChange={(e) => onDate(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ripple-muted">
            Time
          </label>
          <Input
            type="time"
            value={time}
            onChange={(e) => onTime(e.target.value)}
          />
        </div>
      </div>

      <Button
        variant="accent"
        onClick={onSearch}
        disabled={!canSearch || isSearching}
        className={cn("mt-1")}
      >
        {isSearching ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Search size={16} />
        )}
        {isSearching ? "Finding routes…" : "Search routes"}
      </Button>

      {showShortcuts && user && (saved.data?.length || favourites.data?.length) ? (
        <div className="mt-1 flex flex-col gap-4">
          {saved.data && saved.data.length > 0 && (
            <section>
              <SectionHeader title="Saved Locations" href="/saved-locations" />
              <div className="flex flex-col">
                {saved.data.map((loc) => (
                  <button
                    key={loc.id}
                    onClick={() =>
                      onPickSavedLocation({
                        label: loc.label,
                        point: { lat: Number(loc.lat), lng: Number(loc.lng) },
                      })
                    }
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-ripple-muted/10"
                  >
                    <MapPin size={15} className="shrink-0 text-bus" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {loc.label}
                      </span>
                      <span className="block truncate text-xs text-ripple-muted">
                        {loc.address}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {favourites.data && favourites.data.length > 0 && (
            <section>
              <SectionHeader title="Favourite Routes" href="/favourite-routes" />
              <div className="flex flex-col">
                {favourites.data.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onPickFavourite(r.origin, r.destination)}
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-ripple-muted/10"
                  >
                    <Star size={15} className="shrink-0 text-warning" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {r.label}
                      </span>
                      <span className="block truncate text-xs text-ripple-muted">
                        {r.origin} → {r.destination}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ripple-muted">
        {title}
      </h3>
      <Link
        href={href}
        className="text-xs font-medium text-bus hover:underline"
      >
        View all
      </Link>
    </div>
  );
}
