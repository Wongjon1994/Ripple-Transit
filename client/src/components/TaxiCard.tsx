import { Car } from "lucide-react";
import type { TaxiEstimate, TaxiAvailability } from "@shared/types.js";

const AVAIL: Record<TaxiAvailability, { label: string; color: string }> = {
  available: { label: "Available now", color: "#10b981" },
  limited: { label: "Limited nearby", color: "#f59e0b" },
  unavailable: { label: "Few nearby", color: "#dc2626" },
};

/**
 * One-line taxi comparison strip (three-tier discipline: it's a reference
 * point, not a peer option card). Road-delay context now rides the route-level
 * banner at the top of the results, so it's dropped from here.
 */
export function TaxiCard({ taxi }: { taxi: TaxiEstimate }) {
  const a = AVAIL[taxi.availability];
  return (
    <div className="px-1 py-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ripple-muted">
        <Car size={14} className="shrink-0 text-warning" />
        <span className="data-voice min-w-0">
          Taxi ~${taxi.fare.toFixed(2)} · {taxi.durationMin} min · ~
          {taxi.waitMin} min wait · est.
        </span>
        <span
          className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] font-medium"
          style={{ color: a.color }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: a.color }}
          />
          {a.label}
        </span>
      </div>
    </div>
  );
}
