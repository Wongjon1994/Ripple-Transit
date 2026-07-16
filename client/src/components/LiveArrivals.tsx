import { Loader2, Bus } from "lucide-react";
import { trpc } from "../lib/trpc.js";
import { cn } from "../lib/utils.js";

/** LTA crowd load (mirrors server BusLoad; not in shared/types). */
type BusLoad = "SEA" | "SDA" | "LDA" | "";

/** Minutes from now until an ISO arrival time (clamped at 0). */
function etaMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

function LoadChip({ load }: { load: BusLoad }) {
  const map: Record<Exclude<BusLoad, "">, { label: string; cls: string }> = {
    SEA: { label: "Seats", cls: "bg-ok/15 text-ok" },
    SDA: { label: "Standing", cls: "bg-warning/15 text-warning" },
    LDA: { label: "Limited", cls: "bg-error/15 text-error" },
  };
  if (!load) return null;
  const { label, cls } = map[load];
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", cls)}>
      {label}
    </span>
  );
}

function EtaBadge({ min }: { min: number | null }) {
  if (min == null) return <span className="text-xs text-ripple-muted">—</span>;
  return (
    <span className="text-xs font-semibold text-[var(--fg)]">
      {min === 0 ? "Now" : `${min}m`}
    </span>
  );
}

/**
 * Live arrivals board for a bus stop (LTA DataMall, refreshed every 15s). Shows
 * the full board of services at the stop with their next three ETAs and crowd
 * load, soonest-first; the itinerary's own service is highlighted.
 */
export function LiveArrivals({
  busStopCode,
  highlightService,
}: {
  busStopCode: string;
  highlightService?: string;
}) {
  const q = trpc.lta.busArrivals.useQuery(
    { busStopCode },
    { refetchInterval: 15_000, refetchOnWindowFocus: true },
  );

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 px-1 py-3 text-xs text-ripple-muted">
        <Loader2 size={14} className="animate-spin" /> Loading live arrivals…
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="px-1 py-3 text-xs text-ripple-muted">
        Couldn’t load live arrivals right now.
      </div>
    );
  }

  const services = (q.data?.services ?? [])
    .map((s) => ({
      ...s,
      firstEta: etaMinutes(s.nextBus?.estimatedArrival),
    }))
    .sort((a, b) => (a.firstEta ?? 999) - (b.firstEta ?? 999));

  if (services.length === 0) {
    return (
      <div className="px-1 py-3 text-xs text-ripple-muted">
        No buses currently running at this stop.
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ripple-muted">
          Live board · stop {busStopCode}
        </span>
        {q.isFetching && (
          <Loader2 size={12} className="animate-spin text-ripple-muted" />
        )}
      </div>
      <div className="flex flex-col">
        {services.map((s) => {
          const isMine = highlightService && s.serviceNo === highlightService;
          const etas = [s.nextBus, s.nextBus2, s.nextBus3];
          return (
            <div
              key={s.serviceNo}
              className={cn(
                "flex items-center gap-3 border-t border-[var(--border)] px-3 py-2",
                isMine && "bg-bus/5",
              )}
            >
              <span
                className={cn(
                  "inline-flex min-w-[3rem] items-center gap-1 text-sm font-bold",
                  isMine ? "text-bus" : "text-[var(--fg)]",
                )}
              >
                <Bus size={13} /> {s.serviceNo}
              </span>
              <div className="flex flex-1 items-center gap-3">
                {etas.map((nb, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <EtaBadge min={etaMinutes(nb?.estimatedArrival)} />
                    {i === 0 && nb && <LoadChip load={nb.load} />}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
