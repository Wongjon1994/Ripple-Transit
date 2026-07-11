import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, MapPin, Search, Loader2 } from "lucide-react";
import { trpc } from "../lib/trpc.js";
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
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onSelect: (place: Place) => void;
  accent: string;
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
      <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ripple-muted">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: accent }}
        />
        {label}
      </label>
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
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex flex-col gap-3">
        <LocationInput
          label="From"
          accent="#3b82f6"
          value={fromText}
          onChange={onFromText}
          onSelect={onFromSelect}
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
    </div>
  );
}
