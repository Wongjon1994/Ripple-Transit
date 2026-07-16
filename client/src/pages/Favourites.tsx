import { SlidersHorizontal } from "lucide-react";
import { Card, PageShell } from "../components/ui.js";
import { SavedLocationsSection } from "./SavedLocations.js";
import { FavouriteRoutesSection } from "./FavouriteRoutes.js";

/**
 * Favourites — places and routes in one tab, plus a placeholder for the
 * Phase 15 preference layer (routing options + "Nearest ___" recommendations).
 */
export function Favourites() {
  return (
    <PageShell title="Favourites">
      <div className="flex flex-col gap-8">
        <SavedLocationsSection />
        <FavouriteRoutesSection />

        <section>
          <h2 className="eyebrow mb-2 text-ripple-muted">
            Preferences · coming in Phase 15
          </h2>
          <Card className="flex items-start gap-3 p-4">
            <SlidersHorizontal
              size={16}
              className="mt-0.5 shrink-0 text-ripple-muted"
            />
            <p className="text-sm leading-relaxed text-ripple-muted">
              Set how Ripple ranks your options — sheltered-first walking,
              fewest transfers, PCN-preferred rides — and tune the
              &ldquo;Nearest&nbsp;___&rdquo; quick recommendations to the
              places you actually go.
            </p>
          </Card>
        </section>
      </div>
    </PageShell>
  );
}
