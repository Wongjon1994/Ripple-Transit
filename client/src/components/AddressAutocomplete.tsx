import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { trpc } from "../lib/trpc.js";
import { Input, Card } from "./ui.js";
import type { SearchResult } from "@shared/types.js";

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Address search input with OneMap (+HERE fallback) autocomplete.
 * Calls `onSelect` with the full result (including lat/lng) on pick.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Search address or place",
  ariaLabel,
  leftAccent,
  testIdPrefix,
}: {
  value: string;
  onChange: (text: string) => void;
  onSelect: (r: SearchResult) => void;
  placeholder?: string;
  ariaLabel?: string;
  leftAccent?: string;
  testIdPrefix?: string;
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
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const results: SearchResult[] = query.data?.results ?? [];

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        {leftAccent ? (
          <span
            className="pointer-events-none absolute left-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
            style={{ background: leftAccent }}
          />
        ) : (
          <MapPin
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ripple-muted"
          />
        )}
        <Input
          className="pl-8"
          placeholder={placeholder}
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
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
              type="button"
              data-testid={testIdPrefix ? `${testIdPrefix}-${i}` : undefined}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-ripple-muted/10"
              onClick={() => {
                // onChange BEFORE onSelect: consumers treat onChange as "the
                // user typed" and clear their picked result — firing it after
                // onSelect would immediately un-pick the selection.
                onChange(r.title);
                onSelect(r);
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
                <span className="text-[10px] font-semibold uppercase text-brand">
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
