import { PageShell } from "../components/ui.js";
import { PersonalInsights } from "../components/PersonalInsights.js";
import { SustainabilitySection } from "./Sustainability.js";

/**
 * Insights — your travel intelligence. Impact (CO₂) first, then Phase 16's
 * personalised patterns drawn from your own trip log.
 */
export function Insights() {
  return (
    <PageShell title="Insights">
      <div className="flex flex-col gap-8">
        <SustainabilitySection />
        <PersonalInsights />
      </div>
    </PageShell>
  );
}
