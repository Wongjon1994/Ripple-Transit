import { Check, TriangleAlert, OctagonAlert, Info } from "lucide-react";
import { cn } from "../lib/utils.js";

/**
 * The one confidence/risk signal, reused everywhere (§5 consolidation):
 *  - good    — green, check          (low risk, OK buffer, verified/grade A)
 *  - caution — amber, warning-triangle (some risk, tight, unverified, disruption)
 *  - block   — red, alert-octagon    (miss, severe disruption, suspended)
 *  - neutral — gray outline, info     (absence of data — never red)
 * Type/category/wayfinding info must NOT use this component.
 */
export type StatusTier = "good" | "caution" | "block" | "neutral";

const TIER: Record<
  StatusTier,
  { Icon: typeof Check; cls: string }
> = {
  good: { Icon: Check, cls: "bg-ok/15 text-ok" },
  caution: { Icon: TriangleAlert, cls: "bg-warning/15 text-warning" },
  block: { Icon: OctagonAlert, cls: "bg-error/15 text-error" },
  neutral: {
    Icon: Info,
    cls: "border border-[var(--border)] text-ripple-muted",
  },
};

export function StatusBadge({
  tier,
  label,
  size = "sm",
  className,
}: {
  tier: StatusTier;
  label: string;
  /** "md" for the escalated journey banner; "sm" everywhere else. */
  size?: "sm" | "md";
  className?: string;
}) {
  const { Icon, cls } = TIER[tier];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-semibold",
        size === "md"
          ? "px-2.5 py-1 text-xs"
          : "px-2 py-0.5 text-[11px]",
        cls,
        className,
      )}
    >
      <Icon size={size === "md" ? 14 : 11} strokeWidth={2.5} />
      {label}
    </span>
  );
}

/** RiskLevel → status tier: low = good, moderate = caution, high = block. */
export function riskTier(level: "low" | "moderate" | "high"): StatusTier {
  return level === "low" ? "good" : level === "moderate" ? "caution" : "block";
}
