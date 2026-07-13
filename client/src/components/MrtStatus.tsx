import { useState } from "react";
import { ChevronDown, TrainFront, Check, AlertTriangle, XCircle } from "lucide-react";
import { trpc } from "../lib/trpc.js";
import { lineColor, lineName } from "../lib/transit.js";
import { cn } from "../lib/utils.js";

/** Collapsible live MRT line status, for the map sidebar / bottom sheet. */
export function MrtStatus() {
  const [open, setOpen] = useState(false);
  const { data } = trpc.mrt.lineStatuses.useQuery(undefined, {
    staleTime: 60_000,
  });

  if (!data || data.length === 0) return null;

  const affected = data.filter((l) => l.status !== "operational");
  const allOk = affected.length === 0;

  return (
    <div className="border-b border-[var(--border)]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-ripple-muted/5"
      >
        <TrainFront size={15} className="text-mrt" />
        <span className="font-medium">MRT service</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: allOk ? "#10b981" : "#f59e0b" }}
          />
          <span className={allOk ? "text-ripple-muted" : "text-warning"}>
            {allOk
              ? "All lines normal"
              : `${affected.length} line${affected.length > 1 ? "s" : ""} affected`}
          </span>
        </span>
        <ChevronDown
          size={15}
          className={cn(
            "text-ripple-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <ul className="flex flex-col gap-1.5 px-4 pb-3">
          {data.map((s) => {
            const ok = s.status === "operational";
            const Icon = ok
              ? Check
              : s.status === "suspended"
                ? XCircle
                : AlertTriangle;
            return (
              <li key={s.lineCode} className="flex items-center gap-2.5">
                <span
                  className="flex h-5 w-7 items-center justify-center rounded text-[10px] font-bold text-white"
                  style={{ background: lineColor(s.lineCode) }}
                >
                  {s.lineCode}
                </span>
                <span className="flex-1 truncate text-sm">
                  {s.lineName ?? lineName(s.lineCode)}
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs font-medium capitalize",
                    ok ? "text-ok" : "text-warning",
                  )}
                >
                  <Icon size={13} /> {s.status}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
