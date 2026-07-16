import { Leaf, TreePine, Car, Route as RouteIcon, Footprints } from "lucide-react";
import { trpc } from "../lib/trpc.js";
import { Card, PageShell } from "../components/ui.js";

function badgeFor(savedKg: number): { label: string; emoji: string } {
  if (savedKg >= 20) return { label: "Forest Guardian", emoji: "🌳" };
  if (savedKg >= 5) return { label: "Tree Planter", emoji: "🌲" };
  if (savedKg >= 1) return { label: "Sapling", emoji: "🌱" };
  return { label: "Seedling", emoji: "🌿" };
}

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Leaf;
  value: string;
  label: string;
}) {
  return (
    <Card className="flex flex-col gap-1 p-4 shadow-[var(--shadow-card)]">
      <Icon size={18} className="text-ok" />
      <span className="font-serif text-2xl font-bold tracking-tight">
        {value}
      </span>
      <span className="text-xs text-ripple-muted">{label}</span>
    </Card>
  );
}

export function Sustainability() {
  const stats = trpc.sustainability.stats.useQuery();
  const s = stats.data;
  const savedKg = s ? s.totalSavedGrams / 1000 : 0;
  const badge = badgeFor(savedKg);

  return (
    <PageShell title="Your Impact — this month">
      {stats.isLoading ? (
        <p className="text-sm text-ripple-muted">Loading…</p>
      ) : !s || s.trips === 0 ? (
        <Card className="p-8 text-center">
          <Leaf size={28} className="mx-auto text-ok" />
          <p className="mt-3 text-sm text-ripple-muted">
            No trips logged yet this month. Tap <strong>Log trip</strong> on a
            route to start tracking the carbon you save.
          </p>
        </Card>
      ) : (
        <>
          <Card className="mb-3 flex items-center justify-between p-5 shadow-[var(--shadow-card)]">
            <div>
              <div className="flex items-center gap-2 text-ok">
                <Leaf size={20} />
                <span className="eyebrow">CO₂ saved</span>
              </div>
              <div className="mt-1 font-serif text-4xl font-bold tracking-tight">
                {savedKg.toFixed(2)}{" "}
                <span className="font-sans text-lg font-medium text-ripple-muted">
                  kg
                </span>
              </div>
              <div className="mt-1 text-xs text-ripple-muted">
                vs taking taxis for the same trips
              </div>
            </div>
            <div className="text-center">
              <div className="text-4xl">{badge.emoji}</div>
              <div className="mt-1 text-xs font-semibold text-ok">
                {badge.label}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Stat
              icon={RouteIcon}
              value={String(s.trips)}
              label="Trips logged"
            />
            <Stat
              icon={Footprints}
              value={`${(s.totalDistanceM / 1000).toFixed(1)} km`}
              label="Distance travelled"
            />
            <Stat
              icon={Car}
              value={`${s.equivalents.kmDriven} km`}
              label="Car driving avoided"
            />
            <Stat
              icon={TreePine}
              value={`${s.equivalents.treeDays}`}
              label="Tree-days of CO₂"
            />
          </div>
        </>
      )}
    </PageShell>
  );
}
