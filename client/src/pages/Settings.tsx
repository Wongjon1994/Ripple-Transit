import { useLocation } from "wouter";
import { Moon, Sun, SunMoon } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc.js";
import { useTheme } from "../lib/theme.js";
import { useAuth } from "../lib/auth.js";
import { Button, Card, PageShell } from "../components/ui.js";
import { cn } from "../lib/utils.js";

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
  const { mode, theme, setMode } = useTheme();
  const { user, refetch } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

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
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-sm">Theme</span>
            {mode === "auto" && (
              <p className="text-xs text-ripple-muted">
                Following time of day — currently {theme}
              </p>
            )}
          </div>
          <div className="flex gap-1 rounded-md border border-[var(--border)] p-0.5">
            {(
              [
                { m: "auto", label: "Auto", Icon: SunMoon },
                { m: "light", label: "Light", Icon: Sun },
                { m: "dark", label: "Dark", Icon: Moon },
              ] as const
            ).map(({ m, label, Icon }) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex items-center gap-1.5 rounded px-3 py-1 text-sm",
                  mode === m
                    ? "bg-ripple-muted/15 font-medium"
                    : "text-ripple-muted",
                )}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>
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
        contributors. Routing &amp; geocoding by OneMap. Bus &amp; rail data by
        LTA DataMall.
      </p>
    </PageShell>
  );
}
