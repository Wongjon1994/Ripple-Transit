import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  TriangleAlert,
  CloudRain,
  TrainFront,
  Info,
  Crosshair,
  Cloud,
  CloudSun,
  Sun,
  CloudLightning,
} from "lucide-react";
import type {
  PulseSummary,
  PulseRow,
  PulseTallyItem,
  PulseCallout,
  PulsePoint,
} from "../lib/pulseSummary.js";
import { cn } from "../lib/utils.js";

/** A tally item / traffic row that can frame its instances on the map. */
type CycleFn = (key: string, targets: PulsePoint[][]) => void;

const TONE_HEX: Record<PulseTallyItem["tone"], string> = {
  red: "#ef4444",
  amber: "#f59e0b",
  rain: "#8fa3ad",
  flood: "#4f46e5",
};

/** The little colour swatch matches how the thing is drawn on the map: traffic
 *  = a line, crowd = a filled dot, an incident = a hollow ring, rain = a soft
 *  grey dot. So the tally reads as a live key, not just numbers. */
function Swatch({ kind, tone }: { kind: PulseRow["kind"]; tone: PulseTallyItem["tone"] }) {
  // A flash flood gets its storm glyph anywhere it appears, matching the map.
  if (tone === "flood")
    return <CloudLightning size={13} strokeWidth={2.4} className="shrink-0 text-[#4f46e5]" />;
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

/** Wrap tally content in a pill BUTTON when it can frame instances on the map,
 *  so it's obviously tappable; each click cycles to the next one (nearest-first)
 *  with a crosshair affordance. Non-clickable content renders as plain text. */
function Cyclable({
  onClick,
  children,
}: {
  onClick?: () => void;
  children: React.ReactNode;
}) {
  if (!onClick)
    return <span className="flex items-center gap-1 py-0.5">{children}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title="Tap to find these on the map"
      className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-ripple-muted/5 px-2 py-0.5 hover:border-brand/50 hover:bg-brand/5 active:scale-[0.97]"
    >
      {children}
      <Crosshair size={10} className="text-brand" />
    </button>
  );
}

function TallyRow({ row, onCycle }: { row: PulseRow; onCycle?: CycleFn }) {
  // Traffic is area-based, but the panel shows just "Heavy traffic" — tapping
  // it cycles through the affected regions on the map.
  if (row.kind === "traffic") {
    const focus = row.focus;
    const canCycle = !!onCycle && !!focus && focus.length > 0;
    return (
      <div className="flex items-center gap-1.5 text-ripple-muted">
        <Swatch kind="traffic" tone="red" />
        <Cyclable onClick={canCycle ? () => onCycle!("traffic", focus!) : undefined}>
          <span className="font-medium text-[var(--fg)]">Heavy traffic</span>
        </Cyclable>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {(row.items ?? []).map((it, i) => {
        const canCycle = !!onCycle && !!it.focus && it.focus.length > 0;
        return (
          <span key={i} className="flex items-center gap-1.5 text-ripple-muted">
            <Swatch kind={row.kind} tone={it.tone} />
            <Cyclable
              onClick={
                canCycle ? () => onCycle!(`${row.kind}:${it.label}`, it.focus!) : undefined
              }
            >
              <span className="data-voice font-semibold text-[var(--fg)]">
                {it.count}
              </span>
              {it.label}
            </Cyclable>
          </span>
        );
      })}
    </div>
  );
}

const CALLOUT_HEX: Record<PulseCallout["tone"], string> = {
  flood: "#4f46e5",
  mrt: "#ef4444",
  red: "#ef4444",
  amber: "#f59e0b",
  rain: "#8fa3ad",
  muted: "var(--muted)",
};

function CalloutLine({ callout }: { callout: PulseCallout }) {
  // Flood gets the storm glyph; MRT disruption a train (distinct from a road
  // incident); rain a cloud; everything else the warning triangle.
  const Icon =
    callout.tone === "flood"
      ? CloudLightning
      : callout.tone === "mrt"
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

/** A weather glyph matched to the NEA condition text. */
function WeatherIcon({ condition }: { condition: string }) {
  const c = condition.toLowerCase();
  const Icon = /thunder/.test(c)
    ? CloudLightning
    : /rain|shower|drizzle/.test(c)
      ? CloudRain
      : /partly|fair/.test(c)
        ? CloudSun
        : /cloud|overcast|hazy/.test(c)
          ? Cloud
          : Sun;
  return <Icon size={13} className="shrink-0 text-brand" />;
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
  onHeadlineFocus,
  onCycle,
  maxHeight,
  timeLabel,
}: {
  summary: PulseSummary;
  open: boolean;
  onToggle: () => void;
  /** Frame the headline's impacted points on the map (tap-to-zoom). */
  onHeadlineFocus?: (points: { lat: number; lng: number }[]) => void;
  /** Cycle a tally item's instances on the map (nearest-first). */
  onCycle?: CycleFn;
  /** CSS max-height cap so the panel never hides behind the planning sheet. */
  maxHeight?: string;
  timeLabel: string;
}) {
  // Rotate through the ranked headlines like a news ticker — a fresh one every
  // 5s. The index resets whenever the set of headlines changes.
  const headlines = summary.headlines;
  const key = headlines.map((h) => h.text).join("|");
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [key]);
  useEffect(() => {
    if (headlines.length <= 1) return;
    const id = window.setInterval(
      () => setIdx((i) => (i + 1) % headlines.length),
      5000,
    );
    return () => window.clearInterval(id);
  }, [headlines.length]);
  const headline = headlines[idx] ?? summary.headline;
  const canFocus =
    !!onHeadlineFocus && !!headline?.focus && headline.focus.length > 0;
  return (
    <div className="absolute right-[10px] top-[10px] z-[1] w-[244px] max-w-[calc(100vw-20px)] rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 text-[11px] shadow-[0_2px_8px_rgba(0,0,0,0.12)] backdrop-blur-sm md:left-[10px] md:right-auto md:top-[152px]">
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
        <div
          className="flex flex-col gap-1.5 overflow-y-auto overscroll-contain px-2.5 pb-2"
          style={maxHeight ? { maxHeight } : undefined}
        >
          {summary.weather && (
            <div className="-mx-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b border-[var(--border)]/60 px-2.5 pb-1.5 leading-snug text-ripple-muted">
              <span className="flex items-center gap-1.5 text-[var(--fg)]">
                <WeatherIcon condition={summary.weather.condition} />
                {summary.weather.temperature != null && (
                  <span className="data-voice font-semibold">
                    {summary.weather.temperature}°
                  </span>
                )}
                {summary.weather.condition}
              </span>
              {summary.weather.outlook && <span>· {summary.weather.outlook}</span>}
            </div>
          )}

          {headline &&
            (canFocus ? (
              <button
                type="button"
                onClick={() => onHeadlineFocus!(headline.focus!)}
                title="Zoom to the impacted area"
                className={cn(
                  "-mx-2.5 flex items-center gap-1 border-y px-2.5 py-1 text-left font-medium hover:bg-ripple-muted/10",
                  headline.tone === "muted"
                    ? "border-transparent"
                    : "border-[var(--border)]/60",
                )}
              >
                <span className="min-w-0 flex-1">
                  <CalloutLine callout={headline} />
                </span>
                <Crosshair size={12} className="shrink-0 text-ripple-muted" />
              </button>
            ) : (
              <div
                className={cn(
                  "-mx-2.5 border-y px-2.5 py-1 font-medium",
                  headline.tone === "muted"
                    ? "border-transparent"
                    : "border-[var(--border)]/60",
                )}
              >
                <CalloutLine callout={headline} />
              </div>
            ))}

          {headlines.length > 1 && (
            <div className="-mt-0.5 flex items-center gap-1">
              {headlines.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 w-1 rounded-full transition-colors",
                    i === idx ? "bg-[#ef4444]" : "bg-ripple-muted/30",
                  )}
                />
              ))}
            </div>
          )}

          {summary.rows.map((row) => (
            <TallyRow key={row.kind} row={row} onCycle={onCycle} />
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
