import { toast } from "sonner";
import { Card, PageShell } from "../components/ui.js";
import { SavedLocationsSection } from "./SavedLocations.js";
import { FavouriteRoutesSection } from "./FavouriteRoutes.js";
import { ALL_CATS, DEFAULT_CHIP_IDS } from "../components/NearestPanel.js";
import { usePrefs } from "../lib/prefs.js";
import { cn } from "../lib/utils.js";
import type { NearestCategoryId } from "@shared/types.js";

const SUPERMARKET_BRANDS = [
  "FairPrice",
  "Cold Storage",
  "Sheng Siong",
  "Giant",
  "Prime",
];
const ATM_BANKS = ["DBS", "POSB", "OCBC", "UOB", "Standard Chartered", "HSBC"];
const WALK_OPTIONS = [10, 15, 20] as const;

/**
 * Favourites — places and routes in one tab, plus the Phase 15 Preferences
 * that tune the "Nearest ___" quick recommendations.
 */
export function Favourites() {
  return (
    <PageShell title="Favourites">
      <div className="flex flex-col gap-8">
        <SavedLocationsSection />
        <FavouriteRoutesSection />
        <PreferencesSection />
      </div>
    </PageShell>
  );
}

function PreferencesSection() {
  const { prefs, setPrefs } = usePrefs();
  const chips =
    prefs.defaultChips && prefs.defaultChips.length === 4
      ? prefs.defaultChips
      : DEFAULT_CHIP_IDS;

  function toggleChip(id: NearestCategoryId) {
    if (chips.includes(id)) {
      toast.info("Pick a replacement — the default row always has 4 chips.");
      return;
    }
    // Swap in: the new pick replaces the oldest default (front of the list).
    setPrefs({ defaultChips: [...chips.slice(1), id] });
  }

  function toggleBrand(key: "supermarketBrands" | "atmBanks", brand: string) {
    const cur = prefs[key] ?? [];
    setPrefs({
      [key]: cur.includes(brand)
        ? cur.filter((b) => b !== brand)
        : [...cur, brand],
    });
  }

  return (
    <section>
      <h2 className="eyebrow mb-2 text-ripple-muted">Preferences</h2>
      <Card className="flex flex-col gap-5 p-4">
        {/* Default chips */}
        <div>
          <div className="mb-1 text-sm font-semibold">
            Default “Nearest ___” chips
          </div>
          <p className="mb-2 text-xs text-ripple-muted">
            Four always-visible categories on the map screen — tap an unselected
            one to swap it in; the rest live under “More”.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_CATS.map(({ id, label, Icon }) => {
              const active = chips.includes(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleChip(id)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "bg-brand text-white dark:text-[#0f1419]"
                      : "border border-[var(--border)] text-ripple-muted hover:bg-ripple-muted/10",
                  )}
                >
                  <Icon size={12} /> {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Max walk radius */}
        <div>
          <div className="mb-1 text-sm font-semibold">Max walk for Nearest</div>
          <p className="mb-2 text-xs text-ripple-muted">
            Walks up to this long win outright; anything further gets compared
            against transit and cycling.
          </p>
          <div className="flex gap-1 self-start rounded-md border border-[var(--border)] p-0.5">
            {WALK_OPTIONS.map((min) => (
              <button
                key={min}
                onClick={() => setPrefs({ maxWalkMin: min })}
                aria-pressed={(prefs.maxWalkMin ?? 15) === min}
                className={cn(
                  "rounded px-3 py-1 font-mono text-xs font-semibold",
                  (prefs.maxWalkMin ?? 15) === min
                    ? "bg-brand/10 text-brand"
                    : "text-ripple-muted hover:bg-ripple-muted/10",
                )}
              >
                {min} min
              </button>
            ))}
          </div>
        </div>

        {/* Brand filters */}
        <div>
          <div className="mb-1 text-sm font-semibold">Supermarket brands</div>
          <p className="mb-2 text-xs text-ripple-muted">
            Prefer your chains — none selected means any supermarket counts.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUPERMARKET_BRANDS.map((b) => (
              <BrandChip
                key={b}
                label={b}
                active={(prefs.supermarketBrands ?? []).includes(b)}
                onClick={() => toggleBrand("supermarketBrands", b)}
              />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-sm font-semibold">ATM banks</div>
          <div className="flex flex-wrap gap-1.5">
            {ATM_BANKS.map((b) => (
              <BrandChip
                key={b}
                label={b}
                active={(prefs.atmBanks ?? []).includes(b)}
                onClick={() => toggleBrand("atmBanks", b)}
              />
            ))}
          </div>
        </div>
      </Card>
    </section>
  );
}

function BrandChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-gold/15 text-gold ring-1 ring-gold/40"
          : "border border-[var(--border)] text-ripple-muted hover:bg-ripple-muted/10",
      )}
    >
      {label}
    </button>
  );
}
