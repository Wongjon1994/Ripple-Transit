import {
  ChevronDown,
  ChevronRight,
  TriangleAlert,
  CloudRain,
  TrainFront,
  Info,
} from "lucide-react";
import type {
  PulseSummary,
  PulseRow,
  PulseTallyItem,
  PulseCallout,
} from "../lib/pulseSummary.js";
import { cn } from "../lib/utils.js";

const TONE_HEX: Record<PulseTallyItem["tone"], string> = {
  red: "#ef4444",
  amber: "#f59e0b",
  rain: "#8fa3ad",
};

/** The little colour swatch matches how the thing is drawn on the map: traffic
 *  = a line, crowd = a filled dot, an incident = a hollow ring, rain = a soft
 *  grey dot. So the tally reads as a live key, not just numbers. */
function Swatch({ kind, tone }: { kind: PulseRow["kind"]; tone: PulseTallyItem["tone"] }) {
  if (kind === "traffic")
    return (
      <span
        className="inline-block h-[3px] w-4 shrink-0 rounded-full"
        style={{ background: TONE_HEX[tone] }}
      />
    );
  if (kind === "alerts" && tone === "red")
    return (
      <span className="inline-block h-2 w-2 shrink-0 rounded-full border-2 border-[#ef4444] bg-transparent" />
    );
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: TONE_HEX[tone] }}
    />
  );
}

function TallyRow({ row }: { row: PulseRow }) {
  // Traffic is area-based: a red line swatch + "Heavy · <areas>", not a tally.
  if (row.kind === "traffic")
    return (
      <div className="flex items-center gap-1.5 text-ripple-muted">
        <Swatch kind="traffic" tone="red" />
        Heavy ·{" "}
        <span className="font-medium text-[var(--fg)]">{row.text}</span>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
      {(row.items ?? []).map((it, i) => (
        <span key={i} className="flex items-center gap-1 text-ripple-muted">
          <Swatch kind={row.kind} tone={it.tone} />
          <span className="data-voice font-semibold text-[var(--fg)]">
            {it.count}
          </span>
          {it.label}
        </span>
      ))}
    </div>
  );
}

const CALLOUT_HEX: Record<PulseCallout["tone"], string> = {
  mrt: "#ef4444",
  red: "#ef4444",
  amber: "#f59e0b",
  rain: "#8fa3ad",
  muted: "var(--muted)",
};

function CalloutLine({ callout }: { callout: PulseCallout }) {
  // MRT disruption gets a train icon (red) so it reads distinctly from a road
  // incident; rain gets a cloud; everything else the warning triangle.
  const Icon =
    callout.tone === "mrt"
      ? TrainFront
      : callout.tone === "rain"
        ? CloudRain
        : TriangleAlert;
  return (
    <div className="flex items-start gap-1.5">
      {callout.tone !== "muted" && (
        <Icon
          size={12}
          strokeWidth={callout.tone === "mrt" ? 2.5 : 2}
          className="mt-[1px] shrink-0"
          style={{ color: CALLOUT_HEX[callout.tone] }}
        />
      )}
      <span
        className={cn(
          "leading-snug",
          callout.tone === "mrt" && "font-semibold",
        )}
        style={{
          color: callout.tone === "muted" ? "var(--muted)" : "var(--fg)",
        }}
      >
        {callout.text}
      </span>
    </div>
  );
}

/**
 * The dynamic Pulse panel (replaces the static legend): a "LIVE" header with
 * the data timestamp, a "worst right now" headline, live tallies ordered by the
 * user's preferences, and — when their saved places are affected — a "for you"
 * proximity section. Collapses to a single chip so it never blocks the map.
 */
export function PulsePanel({
  summary,
  open,
  onToggle,
  timeLabel,
}: {
  summary: PulseSummary;
  open: boolean;
  onToggle: () => void;
  timeLabel: string;
}) {
  return (
    <div className="absolute left-[10px] top-[152px] z-[1] w-[210px] max-w-[calc(100vw-20px)] rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 text-[11px] shadow-[0_2px_8px_rgba(0,0,0,0.12)] backdrop-blur-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5"
      >
        {open ? (
          <ChevronDown size={11} className="shrink-0 text-brand" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-brand" />
        )}
        <span className="font-mono font-semibold uppercase tracking-[0.08em] text-ripple-muted">
          Pulse
        </span>
        <span className="ml-auto flex items-center gap-1">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ef4444] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#ef4444]" />
          </span>
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#ef4444]">
            Live
          </span>
          {timeLabel && (
            <span className="data-voice text-[10px] text-ripple-muted">
              {timeLabel}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-1.5 px-2.5 pb-2">
          {summary.headline && (
            <div
              className={cn(
                "-mx-2.5 border-y px-2.5 py-1 font-medium",
                summary.headline.tone === "muted"
                  ? "border-transparent"
                  : "border-[var(--border)]/60",
              )}
            >
              <CalloutLine callout={summary.headline} />
            </div>
          )}

          {summary.rows.map((row) => (
            <TallyRow key={row.kind} row={row} />
          ))}

          {summary.personal.length > 0 && (
            <div className="mt-0.5 flex flex-col gap-1 border-t border-[var(--border)]/60 pt-1.5">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-match">
                For you
              </span>
              {summary.personal.map((c, i) => (
                <CalloutLine key={i} callout={c} />
              ))}
            </div>
          )}

          {/* Planned rail adjustments — informational, muted, at most two so
              they never crowd out the live signals above. */}
          {summary.planned.length > 0 && (
            <div className="mt-0.5 flex flex-col gap-1 border-t border-[var(--border)]/60 pt-1.5">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-ripple-muted">
                Planned
              </span>
              {summary.planned.slice(0, 2).map((text, i) => (
                <div key={i} className="flex items-start gap-1.5 text-ripple-muted">
                  <Info size={11} className="mt-[1px] shrink-0" />
                  <span className="leading-snug">{text}</span>
                </div>
              ))}
              {summary.planned.length > 2 && (
                <span className="pl-[18px] text-[10px] text-ripple-muted">
                  +{summary.planned.length - 2} more
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
