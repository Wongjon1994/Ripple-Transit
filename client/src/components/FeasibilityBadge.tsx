import { Check, AlertTriangle, X, HelpCircle } from "lucide-react";
import type { FeasibilityStatus } from "@shared/types.js";
import { cn } from "../lib/utils.js";

const CONFIG: Record<
  FeasibilityStatus,
  {
    label: string;
    icon: typeof Check;
    text: string;
    pill: string;
    accent: string;
    tint: string;
  }
> = {
  ok: {
    label: "OK",
    icon: Check,
    text: "text-ok",
    pill: "text-ok bg-ok/10 border-ok/30",
    accent: "#10b981",
    tint: "rgba(16,185,129,0.08)",
  },
  tight: {
    label: "TIGHT",
    icon: AlertTriangle,
    text: "text-warning",
    pill: "text-warning bg-warning/10 border-warning/30",
    accent: "#f59e0b",
    tint: "rgba(245,158,11,0.08)",
  },
  miss: {
    label: "MISS",
    icon: X,
    text: "text-error",
    pill: "text-error bg-error/10 border-error/30",
    accent: "#dc2626",
    tint: "rgba(220,38,38,0.08)",
  },
  unknown: {
    label: "UNKNOWN",
    icon: HelpCircle,
    text: "text-ripple-muted",
    pill: "text-ripple-muted bg-ripple-muted/10 border-ripple-muted/30",
    accent: "#6b7280",
    tint: "rgba(107,114,128,0.08)",
  },
};

/** Compact pill — used in alternative rows and inline contexts. */
export function FeasibilityBadge({
  status,
  buffer,
  className,
}: {
  status: FeasibilityStatus;
  buffer?: number;
  className?: string;
}) {
  const { label, icon: Icon, pill } = CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        pill,
        className,
      )}
      role="status"
      aria-label={`Feasibility: ${label}`}
    >
      <Icon size={13} strokeWidth={2.5} aria-hidden />
      {label}
      {typeof buffer === "number" && status !== "unknown" && (
        <span className="font-normal opacity-80">
          {buffer >= 0 ? `${buffer} min` : `${Math.abs(buffer)} min short`}
        </span>
      )}
    </span>
  );
}

function headline(status: FeasibilityStatus, buffer: number): string {
  switch (status) {
    case "ok":
      return `OK — ${buffer} minute buffer`;
    case "tight":
      return `TIGHT — ${buffer} minute buffer`;
    case "miss":
      return `MISS — you won't make it`;
    default:
      return "UNKNOWN — live data unavailable";
  }
}

function messageLines(status: FeasibilityStatus, buffer: number): string[] {
  switch (status) {
    case "ok":
      return [
        "You'll arrive at the stop with time to spare.",
        `Comfortable connection — about ${buffer} min of slack.`,
      ];
    case "tight":
      return [
        "You might make it, but it's risky.",
        "If you're delayed you'll miss it — consider the next one.",
      ];
    case "miss":
      return [
        "Even leaving now, you'd reach the stop after it departs.",
        "Check the alternatives below.",
      ];
    default:
      return ["Live arrival data is unavailable for this stop."];
  }
}

/** Full feasibility callout (mockup-1): left accent bar, tinted, colored heading. */
export function FeasibilityCallout({
  status,
  buffer,
}: {
  status: FeasibilityStatus;
  buffer: number;
}) {
  const { icon: Icon, text, accent, tint } = CONFIG[status];
  return (
    <div
      className="rounded-md border-l-4 p-3"
      style={{ borderColor: accent, background: tint }}
      role="status"
    >
      <div className="flex gap-2.5">
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2"
          style={{ borderColor: accent }}
        >
          <Icon size={13} strokeWidth={2.75} style={{ color: accent }} />
        </span>
        <div className="min-w-0">
          <div className={cn("text-sm font-semibold", text)}>
            {headline(status, buffer)}
          </div>
          {messageLines(status, buffer).map((line, i) => (
            <p key={i} className="text-xs leading-relaxed text-ripple-muted">
              {line}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
