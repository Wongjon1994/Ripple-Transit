import {
  Waves,
  Radio,
  Route as RouteIcon,
  Footprints,
  MapPin,
  Leaf,
  CloudSun,
  ShieldCheck,
} from "lucide-react";
import { Card, PageShell } from "../components/ui.js";

const FEATURES: { Icon: typeof Radio; title: string; body: string }[] = [
  {
    Icon: Radio,
    title: "Live, not timetabled",
    body: "Bus arrivals from LTA fold into each route's total time and re-rank the options every minute — so “fastest” means fastest right now, waiting included, not a printed schedule.",
  },
  {
    Icon: ShieldCheck,
    title: "A decision layer, not just a route",
    body: "Every option carries a catchability read (OK / tight / miss), a risk level from live weather, MRT disruptions and road incidents, fare, and CO₂ — the context you'd otherwise gather across five apps.",
  },
  {
    Icon: Footprints,
    title: "Walking & cycling as first-class modes",
    body: "Separate Walk and Cycle tabs with real alternates — fastest, most sheltered (OSM covered walkways), and park-connector-scenic — each scored for comfort, with umbrella and heat callouts when the weather warrants.",
  },
  {
    Icon: MapPin,
    title: "“Nearest ___”, answered by real travel time",
    body: "One tap for the nearest dining, clinic, supermarket, park and more — ranked by actual walk/cycle/transit time from where you are, along your route, or near your destination. Never crow-flies guesses.",
  },
  {
    Icon: RouteIcon,
    title: "Multi-stop, done properly",
    body: "Chain up to five destinations; each leg departs when the last one arrives, with live timing on the segment you're about to start and honest estimates on the rest.",
  },
  {
    Icon: Leaf,
    title: "Your impact, tracked",
    body: "Completed journeys log the carbon you saved versus driving, building a running tally in Insights — quietly making the greener option the obvious one.",
  },
];

const SOURCES: { name: string; use: string; href: string }[] = [
  {
    name: "LTA DataMall",
    use: "Live bus arrivals, bus stops & routes, MRT station data, road incidents",
    href: "https://datamall.lta.gov.sg",
  },
  {
    name: "OneMap",
    use: "Routing (transit, walk, cycle, drive), geocoding & reverse geocoding",
    href: "https://www.onemap.gov.sg",
  },
  {
    name: "data.gov.sg",
    use: "Park connectors, cycling paths, hawker centres, clinics, parks, libraries, sports facilities, attractions, MRT exits, NEA hygiene grades",
    href: "https://data.gov.sg",
  },
  {
    name: "NEA (via data.gov.sg)",
    use: "2-hour & 24-hour weather forecasts, temperature & humidity readings",
    href: "https://www.nea.gov.sg",
  },
  {
    name: "OpenStreetMap",
    use: "Sheltered-walkway network (covered footways) via Overpass",
    href: "https://www.openstreetmap.org/copyright",
  },
  {
    name: "HERE",
    use: "Place discovery for dining outlets, supermarkets & ATMs",
    href: "https://www.here.com",
  },
];

export function About() {
  return (
    <PageShell title="About">
      <div className="flex flex-col gap-6">
        {/* Masthead */}
        <div className="flex items-start gap-3">
          <span className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10">
            <Waves size={22} className="text-brand" />
          </span>
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-tight">
              Ripple Transit
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-ripple-muted">
              Real-time urban mobility intelligence for Singapore. Ripple fuses
              live transit data into a single decision layer — so getting around
              is a confident choice, not a guess. Part of the Ripple suite.
            </p>
          </div>
        </div>

        {/* Weather ambient note */}
        <Card className="flex items-center gap-2.5 p-3 text-xs text-ripple-muted shadow-[var(--shadow-card)]">
          <CloudSun size={15} className="shrink-0 text-brand" />
          Every figure here is real data or a clearly-labelled estimate — Ripple
          never shows a signal it can't stand behind.
        </Card>

        {/* Features */}
        <section>
          <h2 className="eyebrow mb-2 text-ripple-muted">What sets it apart</h2>
          <div className="flex flex-col gap-2">
            {FEATURES.map(({ Icon, title, body }) => (
              <Card key={title} className="flex gap-3 p-4">
                <Icon size={18} className="mt-0.5 shrink-0 text-brand" />
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <p className="mt-0.5 text-sm leading-relaxed text-ripple-muted">
                    {body}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Data sources */}
        <section>
          <h2 className="eyebrow mb-2 text-ripple-muted">Built on open data</h2>
          <Card className="flex flex-col divide-y divide-[var(--border)]">
            {SOURCES.map((s) => (
              <a
                key={s.name}
                href={s.href}
                target="_blank"
                rel="noreferrer noopener"
                className="flex flex-col gap-0.5 p-3.5 hover:bg-ripple-muted/5"
              >
                <span className="text-sm font-semibold text-brand">
                  {s.name}
                </span>
                <span className="text-xs leading-relaxed text-ripple-muted">
                  {s.use}
                </span>
              </a>
            ))}
          </Card>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-ripple-muted">
            Map data © OpenStreetMap contributors. Government datasets under the
            Singapore Open Data Licence. Ripple Transit is an independent
            project and is not affiliated with LTA, NEA, or any agency.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
