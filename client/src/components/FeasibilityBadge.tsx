import { Check, AlertTriangle, X, HelpCircle } from "lucide-react";
import type { FeasibilityStatus } from "@shared/types.js";
import { cn } from "../lib/utils.js";

const CONFIG: Record<
  FeasibilityStatus,
  { label: string; icon: typeof Check; cls: string }
> = {
  ok: {
    label: "OK",
    icon: Check,
    cls: "text-ok bg-ok/10 border-ok/30",
  },
  tight: {
    label: "TIGHT",
    icon: AlertTriangle,
    cls: "text-warning bg-warning/10 border-warning/30",
  },
  miss: {
    label: "MISS",
    icon: X,
    cls: "text-error bg-error/10 border-error/30",
  },
  unknown: {
    label: "UNKNOWN",
    icon: HelpCircle,
    cls: "text-ripple-muted bg-ripple-muted/10 border-ripple-muted/30",
  },
};

export function FeasibilityBadge({
  status,
  buffer,
  className,
}: {
  status: FeasibilityStatus;
  buffer?: number;
  className?: string;
}) {
  const { label, icon: Icon, cls } = CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        cls,
        className,
      )}
      role="status"
      aria-label={`Feasibility: ${label}`}
    >
      <Icon size={13} strokeWidth={2.5} aria-hidden />
      {label}
      {typeof buffer === "number" && status !== "unknown" && (
        <span className="font-normal opacity-80">
          · {buffer >= 0 ? `${buffer} min buffer` : `${Math.abs(buffer)} min short`}
        </span>
      )}
    </span>
  );
}

/** Plain-English explanation shown beneath the badge (per mockup). */
export function feasibilityMessage(
  status: FeasibilityStatus,
  buffer: number,
): string {
  switch (status) {
    case "ok":
      return `You'll arrive about ${buffer} min before the bus departs.`;
    case "tight":
      return `Cutting it close — only ${buffer} min of slack. Walk briskly.`;
    case "miss":
      return `The bus leaves before you can reach the stop (${Math.abs(buffer)} min short).`;
    default:
      return "Live arrival data unavailable for this stop.";
  }
}
