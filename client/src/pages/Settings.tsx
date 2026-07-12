import { useLocation } from "wouter";
import { Check, AlertTriangle, XCircle, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc.js";
import { useTheme } from "../lib/theme.js";
import { useAuth } from "../lib/auth.js";
import { Button, Card, PageShell } from "../components/ui.js";
import { cn } from "../lib/utils.js";
import { lineColor, lineName } from "../lib/transit.js";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mb-3 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ripple-muted">
        {title}
      </h2>
      {children}
    </Card>
  );
}

export function Settings() {
  const { theme, toggleTheme } = useTheme();
  const { user, refetch } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const statuses = trpc.mrt.lineStatuses.useQuery();
  const usage = trpc.here.usageStats.useQuery();

  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      refetch();
      navigate("/");
      toast.success("Signed out.");
    },
  });

  const pct = usage.data
    ? Math.min(100, (usage.data.used / usage.data.cap) * 100)
    : 0;

  return (
    <PageShell title="Settings">
      <Section title="Account">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{user?.email}</div>
            <div className="text-xs capitalize text-ripple-muted">
              {user?.role}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sign out
          </Button>
        </div>
      </Section>

      <Section title="Preferences">
        <div className="flex items-center justify-between">
          <span className="text-sm">Theme</span>
          <div className="flex gap-1 rounded-md border border-[var(--border)] p-0.5">
            <button
              onClick={() => theme === "dark" && toggleTheme()}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1 text-sm",
                theme === "light"
                  ? "bg-ripple-muted/15 font-medium"
                  : "text-ripple-muted",
              )}
            >
              <Sun size={14} /> Light
            </button>
            <button
              onClick={() => theme === "light" && toggleTheme()}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1 text-sm",
                theme === "dark"
                  ? "bg-ripple-muted/15 font-medium"
                  : "text-ripple-muted",
              )}
            >
              <Moon size={14} /> Dark
            </button>
          </div>
        </div>
      </Section>

      <Section title="Transit Status">
        {statuses.isLoading ? (
          <p className="text-sm text-ripple-muted">Loading…</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {statuses.data?.map((s) => {
              const ok = s.status === "operational";
              const Icon = ok
                ? Check
                : s.status === "suspended"
                  ? XCircle
                  : AlertTriangle;
              return (
                <li key={s.lineCode} className="flex items-center gap-2.5">
                  <span
                    className="flex h-6 w-8 items-center justify-center rounded text-[11px] font-bold text-white"
                    style={{ background: lineColor(s.lineCode) }}
                  >
                    {s.lineCode}
                  </span>
                  <span className="flex-1 text-sm">
                    {s.lineName ?? lineName(s.lineCode)}
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1 text-xs font-medium capitalize",
                      ok ? "text-ok" : "text-warning",
                    )}
                  >
                    <Icon size={13} /> {s.status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="API Usage — HERE">
        {usage.data && (
          <>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span>
                {usage.data.used.toLocaleString()} /{" "}
                {usage.data.cap.toLocaleString()} calls
              </span>
              <span className="text-ripple-muted">{pct.toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ripple-muted/15">
              <div
                className={cn(
                  "h-full rounded-full",
                  pct > 90 ? "bg-error" : pct > 70 ? "bg-warning" : "bg-ok",
                )}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-ripple-muted">
              {usage.data.remaining.toLocaleString()} calls remaining this month ·{" "}
              {usage.data.available ? "available" : "cap reached"}
            </p>
          </>
        )}
      </Section>

      <p className="px-1 pb-4 text-[11px] leading-relaxed text-ripple-muted">
        Map data ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          className="hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap
        </a>{" "}
        contributors, © CARTO. Routing &amp; geocoding by OneMap. Bus &amp; rail
        data by LTA DataMall.
      </p>
    </PageShell>
  );
}
