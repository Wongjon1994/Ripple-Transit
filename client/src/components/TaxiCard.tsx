import { Car } from "lucide-react";
import type { TaxiEstimate, TaxiAvailability } from "@shared/types.js";

const AVAIL: Record<TaxiAvailability, { label: string; color: string }> = {
  available: { label: "Available now", color: "#10b981" },
  limited: { label: "Limited nearby", color: "#f59e0b" },
  unavailable: { label: "Few nearby", color: "#dc2626" },
};

/** Taxi comparison card — an alternative to the transit options. */
export function TaxiCard({ taxi }: { taxi: TaxiEstimate }) {
  const a = AVAIL[taxi.availability];
  return (
    <div className="rounded-lg border border-[var(--border)] bg-warning/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warning/20">
            <Car size={18} className="text-warning" />
          </span>
          <div>
            <div className="text-sm font-semibold">Taxi</div>
            <div
              className="flex items-center gap-1 text-xs font-medium"
              style={{ color: a.color }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: a.color }}
              />
              {a.label}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">${taxi.fare.toFixed(2)}</div>
          <div className="text-xs text-ripple-muted">
            {taxi.durationMin} min · {taxi.distanceKm} km
          </div>
        </div>
      </div>
      <div className="mt-1.5 text-[11px] text-ripple-muted">
        Estimate based on LTA regulated rates · ~{taxi.waitMin} min wait ·{" "}
        {taxi.nearbyCount} taxis nearby
      </div>
    </div>
  );
}
