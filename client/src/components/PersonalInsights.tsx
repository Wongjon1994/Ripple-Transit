import {
  Sparkles,
  Repeat,
  Flame,
  TrendingUp,
  TrendingDown,
  Bus,
  Footprints,
  Bike,
  Car,
  TriangleAlert,
} from "lucide-react";
import { Link } from "wouter";
import { trpc } from "../lib/trpc.js";
import { useAuth } from "../lib/auth.js";
import { usePrefs } from "../lib/prefs.js";
import { Card } from "./ui.js";
import { fmtDistance, cn } from "../lib/utils.js";

const MODE_META = {
  transit: { icon: Bus, label: "Transit" },
  walk: { icon: Footprints, label: "Walk" },
  cycle: { icon: Bike, label: "Cycle" },
  taxi: { icon: Car, label: "Taxi" },
  car: { icon: Car, label: "Car" },
} as const;

function Tile({
  icon: Icon,
  eyebrow,
  children,
}: {
  icon: typeof Sparkles;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4 shadow-[var(--shadow-card)]">
      <div className="mb-1.5 flex items-center gap-1.5 text-match">
        <Icon size={14} />
        <span className="eyebrow text-[10px]">{eyebrow}</span>
      </div>
      {children}
    </Card>
  );
}

/**
 * Personalised insights (Phase 16) — patterns from the user's OWN trip log.
 *
 * Deliberately narrow: every tile is something the stored trip data can
 * actually prove. The Phase-16 placeholder also promised "departure windows
 * that beat the crowd" and "where a walk beats the bus"; neither is here,
 * because we store the trip you took, never the crowd you met nor the
 * alternatives you skipped. See server/services/tripInsights.ts.
 */
export function PersonalInsights() {
  const { user } = useAuth();
  const { prefs } = usePrefs();
  // Adaptive learning is consent-gated: only read history into patterns once
  // the user has opted in (at signup or in Preferences).
  const consented = prefs.tripHistoryConsent === true;
  const q = trpc.sustainability.insights.useQuery(undefined, {
    enabled: !!user && consented,
  });

  if (user && !consented) {
    return (
      <Section>
        <Card className="flex items-start gap-3 p-4">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-match" />
          <p className="text-sm leading-relaxed text-ripple-muted">
            Personalised patterns are off. Turn on{" "}
            <Link
              href="/preferences"
              className="font-medium text-brand hover:underline"
            >
              trip-history learning in Preferences
            </Link>{" "}
            to see your repeated routes, mode split and CO₂ streak — we only ever
            analyse your own journeys.
          </p>
        </Card>
      </Section>
    );
  }

  if (!user) {
    return (
      <Section>
        <Card className="flex items-start gap-3 p-4">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-match" />
          <p className="text-sm leading-relaxed text-ripple-muted">
            Sign in and log a few journeys to see patterns from your own
            travel — the routes you repeat, how your modes split, and your CO₂
            streak.
          </p>
        </Card>
      </Section>
    );
  }

  if (q.isLoading) {
    return (
      <Section>
        <p className="text-sm text-ripple-muted">Loading…</p>
      </Section>
    );
  }

  // An error must not masquerade as "you have no patterns yet" — that would
  // quietly tell the user their history is empty when it isn't.
  if (q.error || !q.data) {
    return (
      <Section>
        <Card className="flex items-start gap-3 p-4">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-sm leading-relaxed text-ripple-muted">
            Couldn’t load your patterns just now. Your trips are safe — try
            again in a moment.
          </p>
        </Card>
      </Section>
    );
  }

  const d = q.data;
  const nothingYet =
    d.corridors.length === 0 && d.modes.length === 0 && !d.trend;

  if (nothingYet) {
    return (
      <Section>
        <Card className="flex items-start gap-3 p-4">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-match" />
          <p className="text-sm leading-relaxed text-ripple-muted">
            Nothing to read yet. Log a few journeys and patterns start to
            show — repeated routes need at least two trips, and the trend needs
            a month behind it.
          </p>
        </Card>
      </Section>
    );
  }

  const trendUp = d.trend != null && d.trend.savedGrams >= d.trend.priorSavedGrams;

  return (
    <Section windowDays={d.windowDays}>
      <div className="flex flex-col gap-3">
        {d.corridors.length > 0 && (
          <Tile icon={Repeat} eyebrow="Routes you repeat">
            <ul className="flex flex-col gap-2">
              {d.corridors.map((c) => (
                <li
                  key={`${c.origin}-${c.destination}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {c.origin} ↔ {c.destination}
                  </span>
                  <span className="data-voice shrink-0 whitespace-nowrap text-xs text-ripple-muted">
                    {c.trips}× · {fmtDistance(c.totalDistanceM)}
                  </span>
                </li>
              ))}
            </ul>
          </Tile>
        )}

        {d.modes.length > 0 && (
          <Tile icon={Sparkles} eyebrow="How you travel">
            <div className="flex flex-col gap-1.5">
              {d.modes.map((m) => {
                const meta = MODE_META[m.mode];
                const Icon = meta.icon;
                return (
                  <div key={m.mode} className="flex items-center gap-2">
                    <Icon size={13} className="shrink-0 text-ripple-muted" />
                    <span className="w-14 shrink-0 text-xs">{meta.label}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ripple-muted/15">
                      <div
                        className="h-full rounded-full bg-match"
                        style={{ width: `${m.share}%` }}
                      />
                    </div>
                    <span className="data-voice w-16 shrink-0 text-right text-xs text-ripple-muted">
                      {m.share}% · {m.trips}
                    </span>
                  </div>
                );
              })}
            </div>
          </Tile>
        )}

        {/* Streak pairs with the trend; alone (no prior period yet) it spans,
            rather than leaving a half-width tile with a dangling gap. */}
        <div
          className={cn(
            "grid gap-3",
            d.trend ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          <Tile icon={Flame} eyebrow="Streak">
            <div className="font-serif text-2xl font-bold tracking-tight">
              {d.streakDays}{" "}
              <span className="font-sans text-sm font-medium text-ripple-muted">
                day{d.streakDays === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ripple-muted">
              {d.streakDays > 0
                ? "in a row with a logged trip"
                : "log a trip today to start one"}
            </p>
          </Tile>

          {d.trend && (
            <Tile
              icon={trendUp ? TrendingUp : TrendingDown}
              eyebrow="vs previous 30 days"
            >
              <div className="font-serif text-2xl font-bold tracking-tight">
                {d.trend.savedPct == null
                  ? `${d.trend.trips}`
                  : `${d.trend.savedPct > 0 ? "+" : ""}${d.trend.savedPct}%`}
                {d.trend.savedPct == null && (
                  <span className="font-sans text-sm font-medium text-ripple-muted">
                    {" "}
                    trips
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-ripple-muted">
                {d.trend.savedPct == null
                  ? `vs ${d.trend.priorTrips} before — no CO₂ saved last period to compare`
                  : `CO₂ saved · ${d.trend.trips} trips vs ${d.trend.priorTrips}`}
              </p>
            </Tile>
          )}
        </div>
      </div>
    </Section>
  );
}

function Section({
  windowDays,
  children,
}: {
  windowDays?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="eyebrow mb-2 text-ripple-muted">
        Your patterns{windowDays ? ` · last ${windowDays} days` : ""}
      </h2>
      {children}
    </section>
  );
}
