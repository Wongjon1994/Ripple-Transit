import { useEffect, useMemo, useState } from "react";
import {
  UtensilsCrossed,
  Stethoscope,
  ShoppingCart,
  Trees,
  BookOpen,
  Dumbbell,
  Banknote,
  Landmark,
  ChevronDown,
  Plus,
  LocateFixed,
  Loader2,
  TrainFront,
  Footprints,
  Bike,
  BusFront,
  TriangleAlert,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc.js";
import { keepPreviousData } from "@tanstack/react-query";
import { usePrefs } from "../lib/prefs.js";
import { cn } from "../lib/utils.js";
import type {
  LatLng,
  NearestAnchor,
  NearestBusStop,
  NearestCategoryId,
  NearestResult,
} from "@shared/types.js";

interface CatDef {
  id: NearestCategoryId;
  label: string;
  Icon: typeof UtensilsCrossed;
}

export const ALL_CATS: CatDef[] = [
  { id: "hawker", label: "Hawker centre", Icon: UtensilsCrossed },
  { id: "clinic", label: "Clinic", Icon: Stethoscope },
  { id: "supermarket", label: "Supermarket", Icon: ShoppingCart },
  { id: "park", label: "Park", Icon: Trees },
  { id: "library", label: "Library", Icon: BookOpen },
  { id: "sports", label: "Public sports facility", Icon: Dumbbell },
  { id: "atm", label: "ATM", Icon: Banknote },
  { id: "attraction", label: "Attraction", Icon: Landmark },
];
export const DEFAULT_CHIP_IDS: NearestCategoryId[] = [
  "hawker",
  "clinic",
  "supermarket",
  "park",
];

function modeIcon(mode: NearestResult["mode"], size = 12) {
  if (mode === "walk") return <Footprints size={size} />;
  if (mode === "cycle") return <Bike size={size} />;
  return <BusFront size={size} />;
}

/**
 * "Nearest ___" quick recommendations (Phase 15): anchor pills, category
 * chips, top-3 results by real routing time, minimize-on-select strip, and
 * the always-visible Nearest-MRT utility. Lives on the default Map screen.
 */
export function NearestPanel({
  destination,
  destinationLabel,
  routeFrom,
  routeTo,
  onPickNearYou,
  onPickNearDestination,
  onPickAlongTheWay,
  onPickBusStop,
  onPoisChange,
  onCorridorChange,
}: {
  /** Resolved destination point (enables the Near-destination anchor). */
  destination: LatLng | null;
  destinationLabel?: string;
  /** Active-leg endpoints of the current search (enable Along the way). */
  routeFrom: LatLng | null;
  routeTo: LatLng | null;
  onPickNearYou: (myLocation: LatLng, r: NearestResult) => void;
  onPickNearDestination: (r: NearestResult) => void;
  onPickAlongTheWay: (r: NearestResult) => void;
  onPickBusStop: (myLocation: LatLng, stop: NearestBusStop) => void;
  onPoisChange: (pois: { point: LatLng; name: string }[]) => void;
  onCorridorChange: (show: boolean) => void;
}) {
  const [anchor, setAnchor] = useState<NearestAnchor>("you");
  const [category, setCategory] = useState<NearestCategoryId | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [picked, setPicked] = useState<NearestResult | null>(null);
  const [myLocation, setMyLocation] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);

  // Preferences: chip layout + ranking knobs (guests get sane defaults).
  const { prefs } = usePrefs();
  const chipIds =
    prefs.defaultChips && prefs.defaultChips.length === 4
      ? prefs.defaultChips
      : DEFAULT_CHIP_IDS;
  const defaultCats = chipIds
    .map((id) => ALL_CATS.find((c) => c.id === id))
    .filter((c): c is CatDef => !!c);
  const moreCats = ALL_CATS.filter((c) => !chipIds.includes(c.id));
  const nearestPrefs = useMemo(
    () => ({
      maxWalkMin: prefs.maxWalkMin,
      supermarketBrands: prefs.supermarketBrands,
      atmBanks: prefs.atmBanks,
    }),
    [prefs.maxWalkMin, prefs.supermarketBrands, prefs.atmBanks],
  );

  const canDestination = !!destination;
  const canRoute = !!routeFrom && !!routeTo;

  // Never silently swap anchors: if the active anchor becomes unavailable
  // (e.g. destination cleared), fall back to the default explicitly.
  useEffect(() => {
    if (
      (anchor === "destination" && !canDestination) ||
      (anchor === "route" && !canRoute)
    ) {
      setAnchor("you");
    }
  }, [anchor, canDestination, canRoute]);

  function requestLocation() {
    if (!navigator.geolocation) {
      toast.error("Geolocation isn't supported by this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
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

  const anchorPoint =
    anchor === "you" ? myLocation : anchor === "destination" ? destination : null;

  const pointQuery = trpc.nearest.query.useQuery(
    category && anchorPoint
      ? { category, point: anchorPoint, prefs: nearestPrefs }
      : (undefined as never),
    {
      enabled: !!category && anchor !== "route" && !!anchorPoint,
      staleTime: 60_000,
      retry: false,
      placeholderData: keepPreviousData,
    },
  );
  const routeQuery = trpc.nearest.alongTheWay.useQuery(
    category && routeFrom && routeTo
      ? { category, from: routeFrom, to: routeTo, prefs: nearestPrefs }
      : (undefined as never),
    {
      enabled: !!category && anchor === "route" && canRoute,
      staleTime: 120_000,
      retry: false,
      placeholderData: keepPreviousData,
    },
  );
  const active = anchor === "route" ? routeQuery : pointQuery;
  const results = active.data?.results ?? [];
  const disclaimer = results.find((r) => r.disclaimer)?.disclaimer;

  // Feed the map: POI pins while browsing, corridor band for Along the way.
  useEffect(() => {
    const show = !!category && !minimized;
    onPoisChange(
      show ? results.map((r) => ({ point: r.point, name: r.name })) : [],
    );
    onCorridorChange(show && anchor === "route");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, minimized, anchor, active.data]);

  function pick(r: NearestResult) {
    setPicked(r);
    setMinimized(true);
    if (anchor === "route") onPickAlongTheWay(r);
    else if (anchor === "destination") onPickNearDestination(r);
    else if (myLocation) onPickNearYou(myLocation, r);
  }

  function tapChip(id: NearestCategoryId) {
    setPicked(null);
    setMinimized(false);
    setCategory((c) => (c === id ? null : id));
  }

  const catDef = ALL_CATS.find((c) => c.id === category);

  const anchorLabel: Record<NearestAnchor, string> = {
    you: "Near you",
    destination: "Near destination",
    route: "Along the way",
  };

  return (
    <div className="border-t border-[var(--border)] px-4 py-3">
      <NearestTransit
        myLocation={myLocation}
        locating={locating}
        onRequestLocation={requestLocation}
        onPickBusStop={onPickBusStop}
      />

      {/* Anchor — an eyebrow that becomes a 3-pill toggle once both ends exist */}
      <div className="mb-2 mt-3 flex items-center justify-between gap-2">
        <span className="eyebrow text-ripple-muted">Nearest ___</span>
      </div>
      {(canDestination || canRoute) && (
        <div className="mb-2 flex gap-1" role="radiogroup" aria-label="Anchor">
          {(
            [
              ["you", true],
              ["destination", canDestination],
              ["route", canRoute],
            ] as [NearestAnchor, boolean][]
          ).map(([a, enabled]) =>
            !enabled ? null : (
              <button
                key={a}
                role="radio"
                aria-checked={anchor === a}
                onClick={() => {
                  setAnchor(a);
                  setPicked(null);
                  setMinimized(false);
                }}
                className={cn(
                  "rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors",
                  anchor === a
                    ? "bg-brand text-white dark:text-[#0f1419]"
                    : "bg-ripple-muted/10 text-ripple-muted hover:bg-ripple-muted/20",
                )}
              >
                {anchorLabel[a]}
              </button>
            ),
          )}
        </div>
      )}

      {/* Category chips: 4 defaults + More overflow */}
      <div className="flex flex-wrap gap-1.5">
        {defaultCats.map(({ id, label, Icon }) => (
          <Chip
            key={id}
            active={category === id}
            onClick={() => tapChip(id)}
            Icon={Icon}
            label={label}
          />
        ))}
        <button
          onClick={() => setShowMore((s) => !s)}
          aria-expanded={showMore}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-ripple-muted hover:bg-ripple-muted/10"
        >
          More{" "}
          <ChevronDown
            size={12}
            className={cn("transition-transform", showMore && "rotate-180")}
          />
        </button>
        {showMore &&
          moreCats.map(({ id, label, Icon }) => (
            <Chip
              key={id}
              active={category === id}
              onClick={() => tapChip(id)}
              Icon={Icon}
              label={label}
            />
          ))}
      </div>

      {/* Location gate — explicit, never a silent fallback */}
      {category && anchor === "you" && !myLocation && (
        <button
          onClick={requestLocation}
          disabled={locating}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-brand/40 bg-brand/5 px-3 py-2 text-xs font-semibold text-brand disabled:opacity-60"
        >
          {locating ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <LocateFixed size={13} />
          )}
          Use my location to find the nearest {catDef?.label.toLowerCase()}
        </button>
      )}

      {/* Minimized strip after a pick — browsing is one tap away */}
      {category && minimized && picked && (
        <button
          onClick={() => setMinimized(false)}
          className="mt-2.5 flex w-full items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-xs"
        >
          {catDef && <catDef.Icon size={13} className="shrink-0 text-brand" />}
          <span className="min-w-0 truncate">
            <span className="text-ripple-muted">{catDef?.label} · </span>
            <span className="font-semibold">{picked.name}</span>
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-brand">
            <Pencil size={11} /> Change
          </span>
        </button>
      )}

      {/* Results */}
      {category && !minimized && anchorPointReady(anchor, myLocation, destination, canRoute) && (
        <div className="mt-2.5">
          <div className="eyebrow mb-1.5 text-[10px] text-ripple-muted">
            3 nearest · {catDef?.label} · {anchorLabel[anchor]}
          </div>
          {active.isLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-ripple-muted">
              <Loader2 size={13} className="animate-spin" /> Ranking by real
              travel time…
            </div>
          ) : results.length === 0 ? (
            <p className="py-1.5 text-xs text-ripple-muted">
              No verified {catDef?.label.toLowerCase()} found{" "}
              {anchor === "route"
                ? "along this route — try “Near you” or “Near destination”."
                : "nearby."}
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-[var(--border)]">
              {results.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => pick(r)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-ripple-muted/5",
                    i > 0 && "border-t border-[var(--border)]",
                  )}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 font-mono text-[10px] font-bold text-brand">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {r.name}
                  </span>
                  <span className="data-voice flex shrink-0 items-center gap-1.5 text-xs text-brand">
                    {anchor === "route" ? (
                      <>
                        +{Math.round((r.detourS ?? 0) / 60)} min detour
                        <Plus size={13} className="rounded-full bg-brand/10 p-0.5" />
                      </>
                    ) : (
                      <>
                        {modeIcon(r.mode)} {Math.round(r.durationS / 60)} min ·
                        ${r.fare.toFixed(r.fare % 1 === 0 ? 0 : 2)}
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
          {disclaimer && (
            <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-ripple-muted">
              <TriangleAlert size={11} className="mt-0.5 shrink-0 text-warning" />
              {disclaimer}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function anchorPointReady(
  anchor: NearestAnchor,
  myLocation: LatLng | null,
  destination: LatLng | null,
  canRoute: boolean,
): boolean {
  if (anchor === "you") return !!myLocation;
  if (anchor === "destination") return !!destination;
  return canRoute;
}

function Chip({
  active,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: typeof UtensilsCrossed;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-brand text-white dark:text-[#0f1419]"
          : "border border-[var(--border)] text-[var(--fg)] hover:bg-ripple-muted/10",
      )}
    >
      <Icon size={12} /> {label}
    </button>
  );
}

/** Always-visible "Nearest transit" utility: MRT stations + bus stops with
 *  live countdowns (wayfinding primitives, not errand chips). */
function NearestTransit({
  myLocation,
  locating,
  onRequestLocation,
  onPickBusStop,
}: {
  myLocation: LatLng | null;
  locating: boolean;
  onRequestLocation: () => void;
  onPickBusStop: (myLocation: LatLng, stop: NearestBusStop) => void;
}) {
  const q = trpc.nearest.mrt.useQuery(
    myLocation ? { point: myLocation } : (undefined as never),
    { enabled: !!myLocation, staleTime: 120_000, retry: false },
  );
  const bus = trpc.nearest.busStops.useQuery(
    myLocation ? { point: myLocation } : (undefined as never),
    { enabled: !!myLocation, refetchInterval: 30_000, retry: false },
  );

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="eyebrow text-ripple-muted">Nearest transit</span>
        {!myLocation && (
          <button
            onClick={onRequestLocation}
            disabled={locating}
            className="flex items-center gap-1 text-xs font-medium text-brand hover:underline disabled:opacity-60"
          >
            {locating ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <LocateFixed size={11} />
            )}
            Use my location
          </button>
        )}
      </div>
      {myLocation &&
        (q.isLoading ? (
          <div className="flex items-center gap-2 py-1 text-xs text-ripple-muted">
            <Loader2 size={12} className="animate-spin" /> Finding stations…
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {(q.data?.stations ?? []).map((s) => (
              <div
                key={s.name}
                className={cn(
                  "rounded-md border px-2.5 py-1.5",
                  s.disrupted.length > 0
                    ? "border-warning/40 bg-warning/5"
                    : "border-[var(--border)]",
                )}
              >
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <TrainFront size={13} className="shrink-0 text-mrt" />
                  <span className="truncate">
                    {s.name.replace(/ MRT Station$/i, "")}
                  </span>
                </div>
                {s.disrupted.length > 0 ? (
                  <div className="data-voice mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-warning">
                    <TriangleAlert size={11} />
                    {s.disrupted
                      .map((d) => `${d.lineCode} line ${d.status}`)
                      .join(" · ")}
                  </div>
                ) : (
                  <div className="data-voice mt-0.5 text-[11px] text-ripple-muted">
                    {s.walkMinutes} min walk
                    {s.lines.length > 0 ? ` · ${s.lines.join("/")}` : ""}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

      {/* Bus stops with live countdowns — tap to walk there w/ the board */}
      {myLocation && (bus.data?.stops.length ?? 0) > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {bus.data!.stops.map((s) => (
            <button
              key={s.code}
              onClick={() => onPickBusStop(myLocation, s)}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-left hover:bg-ripple-muted/5",
                s.noLiveData || s.longGap
                  ? "border-warning/40 bg-warning/5"
                  : "border-[var(--border)]",
              )}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <BusFront size={13} className="shrink-0 text-bus" />
                <span className="truncate">{s.name}</span>
              </div>
              <div className="data-voice mt-0.5 text-[11px] text-ripple-muted">
                {s.walkMinutes} min walk · {s.code}
              </div>
              {s.noLiveData ? (
                <div className="data-voice mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-warning">
                  <TriangleAlert size={11} /> live arrivals unavailable
                </div>
              ) : (
                <div className="data-voice mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
                  {s.services.map((svc) => (
                    <span key={svc.no} className="font-semibold text-bus">
                      {svc.no}{" "}
                      <span className="font-normal text-ripple-muted">
                        {svc.mins === 0 ? "now" : `${svc.mins}m`}
                      </span>
                    </span>
                  ))}
                  {s.longGap && (
                    <span className="flex items-center gap-0.5 font-semibold text-warning">
                      <TriangleAlert size={10} /> long gap
                    </span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
