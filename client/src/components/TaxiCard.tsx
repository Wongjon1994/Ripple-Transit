import { Car } from "lucide-react";
import type { TaxiEstimate, TaxiAvailability } from "@shared/types.js";

const AVAIL: Record<TaxiAvailability, { label: string; color: string }> = {
  available: { label: "Available now", color: "#10b981" },
  limited: { label: "Limited nearby", color: "#f59e0b" },
  unavailable: { label: "Few nearby", color: "#dc2626" },
};

/** Slim taxi comparison row, consistent with the transit option cards. */
export function TaxiCard({ taxi }: { taxi: TaxiEstimate }) {
  const a = AVAIL[taxi.availability];
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Car size={16} className="text-warning" />
          <span className="text-sm font-semibold">Taxi</span>
          <span
            className="ml-1 inline-flex items-center gap-1 text-xs font-medium"
            style={{ color: a.color }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: a.color }}
            />
            {a.label}
          </span>
        </div>
        <div className="text-right">
          <span className="text-base font-semibold">
            ${taxi.fare.toFixed(2)}
          </span>
          <span className="ml-1.5 text-xs text-ripple-muted">
            {taxi.durationMin} min
          </span>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-ripple-muted">
        LTA-rate estimate · ~{taxi.waitMin} min wait
      </div>
    </div>
  );
}
