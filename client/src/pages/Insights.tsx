import { Sparkles } from "lucide-react";
import { Card, PageShell } from "../components/ui.js";
import { SustainabilitySection } from "./Sustainability.js";

/**
 * Insights — your travel intelligence. Impact (CO₂) is the first section;
 * Phase 16 adds personalised insights from your trip history.
 */
export function Insights() {
  return (
    <PageShell title="Insights">
      <div className="flex flex-col gap-8">
        <SustainabilitySection />

        <section>
          <h2 className="eyebrow mb-2 text-ripple-muted">
            Personalised insights · coming in Phase 16
          </h2>
          <Card className="flex items-start gap-3 p-4">
            <Sparkles size={16} className="mt-0.5 shrink-0 text-gold" />
            <p className="text-sm leading-relaxed text-ripple-muted">
              Patterns from your own journeys — your busiest corridors, the
              departure windows that actually beat the crowd, streaks on your
              CO₂ savings, and where a walk or ride quietly beats the bus.
            </p>
          </Card>
        </section>
      </div>
    </PageShell>
  );
}
