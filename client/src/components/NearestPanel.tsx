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
  Clock,
  SlidersHorizontal,
} from "lucide-react";
import { Link } from "wouter";
import { StatusBadge } from "./StatusBadge.js";
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
  OpeningHours,
} from "@shared/types.js";

interface CatDef {
  id: NearestCategoryId;
  label: string;
  Icon: typeof UtensilsCrossed;
}

export const ALL_CATS: CatDef[] = [
  { id: "dining", label: "Dining", Icon: UtensilsCrossed },
  { id: "clinic", label: "Clinic", Icon: Stethoscope },
  { id: "supermarket", label: "Supermarket", Icon: ShoppingCart },
  { id: "park", label: "Park", Icon: Trees },
  { id: "library", label: "Library", Icon: BookOpen },
  { id: "sports", label: "Public sports facility", Icon: Dumbbell },
  { id: "atm", label: "ATM", Icon: Banknote },
  { id: "attraction", label: "Attraction", Icon: Landmark },
];
export const DEFAULT_CHIP_IDS: NearestCategoryId[] = [
  "dining",
  "clinic",
  "supermarket",
  "park",
];

// The transit utility is folded into the chip row as a special category with
// its own 4-box display and only Near-you / Near-destination anchors.
type ChipId = NearestCategoryId | "transit";

/** Synthesize a NearestResult for an MRT/bus-stop tap (reuses the pick flow). */
function stationResult(point: LatLng, name: string): NearestResult {
  return {
    id: `stn-${name}`,
    name,
    point,
    mode: "transit",
    durationS: 0,
    fare: 0,
    steps: 0,
  };
}

function modeIcon(mode: NearestResult["mode"], size = 12) {
  if (mode === "walk") return <Footprints size={size} />;
  if (mode === "cycle") return <Bike size={size} />;
  return <BusFront size={size} />;
}

/** Compact open/closed line shown under a result name (OSM opening hours). */
function HoursStatus({ hours }: { hours: OpeningHours }) {
  const tone =
    hours.openNow === true
      ? "text-ok"
      : hours.openNow === false
        ? "text-warning"
        : "text-ripple-muted";
  const dot =
    hours.openNow === true
      ? "bg-ok"
      : hours.openNow === false
        ? "bg-warning"
        : "bg-ripple-muted";
  return (
    <span className={cn("mt-0.5 flex items-center gap-1 text-[11px]", tone)}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
      <span className="truncate">{hours.status}</span>
    </span>
  );
}

/** Expanded seven-day schedule (from today), today's row emphasised. */
function WeeklyHours({ hours }: { hours: OpeningHours }) {
  return (
    <div className="border-t border-[var(--border)] bg-ripple-muted/5 px-3 py-2">
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        {hours.week.map((d, i) => (
          <div key={d.day} className="contents">
            <span
              className={cn(
                "font-mono uppercase tracking-[0.04em]",
                i === 0 ? "font-bold text-fg" : "text-ripple-muted",
              )}
            >
              {d.day}
            </span>
            <span
              className={cn(
                "data-voice text-right",
                d.label === "Closed" ? "text-ripple-muted" : "text-fg",
                i === 0 && "font-medium",
              )}
            >
              {d.label}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[10px] text-ripple-muted">
        Hours from OpenStreetMap · verify before travelling
      </div>
    </div>
  );
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
  const [category, setCategory] = useState<ChipId | null>(null);
  const isTransit = category === "transit";
  const [showMore, setShowMore] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [picked, setPicked] = useState<NearestResult | null>(null);
  const [hoursOpen, setHoursOpen] = useState<string | null>(null);
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
  // (e.g. destination cleared, or "Along the way" on the transit category
  // which doesn't support it), fall back to the default explicitly.
  useEffect(() => {
    if (
      (anchor === "destination" && !canDestination) ||
      (anchor === "route" && (!canRoute || isTransit))
    ) {
      setAnchor("you");
    }
  }, [anchor, canDestination, canRoute, isTransit]);

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

  const poiCategory =
    category && category !== "transit" ? category : null;
  const pointQuery = trpc.nearest.query.useQuery(
    poiCategory && anchorPoint
      ? { category: poiCategory, point: anchorPoint, prefs: nearestPrefs }
      : (undefined as never),
    {
      enabled: !!poiCategory && anchor !== "route" && !!anchorPoint,
      staleTime: 60_000,
      retry: false,
      placeholderData: keepPreviousData,
    },
  );
  const routeQuery = trpc.nearest.alongTheWay.useQuery(
    poiCategory && routeFrom && routeTo
      ? { category: poiCategory, from: routeFrom, to: routeTo, prefs: nearestPrefs }
      : (undefined as never),
    {
      enabled: !!poiCategory && anchor === "route" && canRoute,
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

  function tapChip(id: ChipId) {
    setPicked(null);
    setMinimized(false);
    if (id === "transit" && anchor === "route") setAnchor("you");
    setCategory((c) => (c === id ? null : id));
  }

  const catDef = ALL_CATS.find((c) => c.id === category);
  const catLabel = isTransit ? "MRT / bus stop" : (catDef?.label ?? "");

  const anchorLabel: Record<NearestAnchor, string> = {
    you: "Near you",
    destination: "Near destination",
    route: "Along the way",
  };

  return (
    <div className="border-t border-[var(--border)] px-4 py-3">
      {/* Anchor — an eyebrow that becomes a pill toggle once both ends exist.
          The transit category offers Near you / Near destination only. */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="eyebrow text-ripple-muted">Nearest ___</span>
        <Link
          href="/preferences"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline"
        >
          <SlidersHorizontal size={12} /> Preferences
        </Link>
      </div>
      {category && (canDestination || canRoute) && (
        <div className="mb-2 flex gap-1" role="radiogroup" aria-label="Anchor">
          {(
            [
              ["you", true],
              ["destination", canDestination],
              ["route", canRoute && !isTransit],
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

      {/* Category chips: transit utility + 4 POI defaults + More overflow */}
      <div className="flex flex-wrap gap-1.5">
        <Chip
          active={isTransit}
          onClick={() => tapChip("transit")}
          Icon={TrainFront}
          label="MRT / Bus stop"
        />
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

      {/* Compensates for the hidden anchor toggle (§2): keep the three search
          anchors discoverable until a category is chosen. */}
      {!category && (
        <p className="mt-2 text-xs text-ripple-muted">
          Tap a category to search near you, your destination, or along the way.
        </p>
      )}

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
          Use my location to find the nearest {catLabel.toLowerCase()}
        </button>
      )}

      {/* Minimized strip after a pick — browsing is one tap away */}
      {category && minimized && picked && (
        <button
          onClick={() => setMinimized(false)}
          className="mt-2.5 flex w-full items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-xs"
        >
          {catDef && <catDef.Icon size={13} className="shrink-0 text-brand" />}
          <span className="min-w-0">
            <span className="text-ripple-muted">{catDef?.label} · </span>
            <span className="font-semibold">{picked.name}</span>
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-brand">
            <Pencil size={11} /> Change
          </span>
        </button>
      )}

      {/* Transit category: its own 4-box display (2 MRT + 2 bus stops) */}
      {isTransit &&
        anchorPointReady(anchor, myLocation, destination, canRoute) && (
          <div className="mt-2.5">
            <div className="eyebrow mb-1.5 text-[10px] text-ripple-muted">
              Nearest MRT / bus stop · {anchorLabel[anchor]}
            </div>
            <NearestTransit
              point={anchor === "destination" ? destination : myLocation}
              onPickStation={(pt, name) =>
                anchor === "destination"
                  ? onPickNearDestination(stationResult(pt, name))
                  : myLocation &&
                    onPickNearYou(myLocation, stationResult(pt, name))
              }
              onPickBusStop={(stop) =>
                anchor === "destination"
                  ? onPickNearDestination(stationResult(stop.point, stop.name))
                  : myLocation && onPickBusStop(myLocation, stop)
              }
            />
          </div>
        )}

      {/* POI results (3 nearest) */}
      {!isTransit && category && !minimized && anchorPointReady(anchor, myLocation, destination, canRoute) && (
        <div className="mt-2.5">
          <div className="eyebrow mb-1.5 text-[10px] text-ripple-muted">
            3 nearest · {catLabel} · {anchorLabel[anchor]}
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
                <div
                  key={r.id}
                  className={cn(i > 0 && "border-t border-[var(--border)]")}
                >
                  <div className="flex items-stretch">
                    <button
                      onClick={() => pick(r)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left hover:bg-ripple-muted/5"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 font-mono text-[10px] font-bold text-brand">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium">
                          {r.name}
                          {(r.tag || r.grade) && (
                            <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
                              {r.tag && (
                                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-ripple-muted">
                                  {r.tag}
                                </span>
                              )}
                              {r.grade && (
                                <StatusBadge
                                  tier={
                                    r.grade === "A"
                                      ? "good"
                                      : r.grade === "B"
                                        ? "caution"
                                        : "block"
                                  }
                                  label={r.grade}
                                  className="align-middle"
                                />
                              )}
                            </span>
                          )}
                        </span>
                        {r.hours && <HoursStatus hours={r.hours} />}
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
                    {r.hours && (
                      <button
                        onClick={() =>
                          setHoursOpen((cur) => (cur === r.id ? null : r.id))
                        }
                        aria-label="Opening hours"
                        aria-expanded={hoursOpen === r.id}
                        className="flex shrink-0 items-center border-l border-[var(--border)] px-2 text-ripple-muted hover:bg-ripple-muted/5"
                      >
                        <Clock size={14} />
                        <ChevronDown
                          size={13}
                          className={cn(
                            "transition-transform",
                            hoursOpen === r.id && "rotate-180",
                          )}
                        />
                      </button>
                    )}
                  </div>
                  {r.hours && hoursOpen === r.id && (
                    <WeeklyHours hours={r.hours} />
                  )}
                </div>
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

/** "Nearest MRT / bus stop" — its own 4-box display (2 MRT + 2 bus), tappable.
 *  Driven by the active anchor point (your location, or the destination). */
function NearestTransit({
  point,
  onPickStation,
  onPickBusStop,
}: {
  point: LatLng | null;
  onPickStation: (point: LatLng, name: string) => void;
  onPickBusStop: (stop: NearestBusStop) => void;
}) {
  const q = trpc.nearest.mrt.useQuery(
    point ? { point } : (undefined as never),
    { enabled: !!point, staleTime: 120_000, retry: false },
  );
  const bus = trpc.nearest.busStops.useQuery(
    point ? { point } : (undefined as never),
    { enabled: !!point, refetchInterval: 30_000, retry: false },
  );

  return (
    <div>
      {point &&
        (q.isLoading ? (
          <div className="flex items-center gap-2 py-1 text-xs text-ripple-muted">
            <Loader2 size={12} className="animate-spin" /> Finding stations…
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {(q.data?.stations ?? []).map((s) => (
              <button
                key={s.name}
                onClick={() => onPickStation(s.point, s.name)}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-left hover:bg-ripple-muted/5",
                  s.disrupted.length > 0
                    ? "border-warning/40 bg-warning/5"
                    : "border-[var(--border)]",
                )}
              >
                <div className="flex items-start gap-1.5 text-sm font-medium">
                  <TrainFront size={13} className="mt-0.5 shrink-0 text-mrt" />
                  <span>
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
              </button>
            ))}
          </div>
        ))}

      {/* Bus stops with live countdowns — tap to walk there w/ the board */}
      {point && (bus.data?.stops.length ?? 0) > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {bus.data!.stops.map((s) => (
            <button
              key={s.code}
              onClick={() => onPickBusStop(s)}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-left hover:bg-ripple-muted/5",
                s.noLiveData || s.longGap
                  ? "border-warning/40 bg-warning/5"
                  : "border-[var(--border)]",
              )}
            >
              <div className="flex items-start gap-1.5 text-sm font-medium">
                <BusFront size={13} className="mt-0.5 shrink-0 text-bus" />
                <span>{s.name}</span>
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
