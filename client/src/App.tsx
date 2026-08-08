import { Route, Switch, Link, useLocation, Redirect } from "wouter";
import {
  Moon,
  Sun,
  Waves,
  User,
  Info,
  Map as MapIcon,
  BarChart3,
  Settings,
} from "lucide-react";
import { type ReactNode } from "react";
import { useTheme } from "./lib/theme.js";
import { useAuth } from "./lib/auth.js";
import { useJourney } from "./lib/journey.js";
import { Home } from "./pages/Home.js";
import { Login } from "./pages/Login.js";
import { Favourites } from "./pages/Favourites.js";
import { Insights } from "./pages/Insights.js";
import { About } from "./pages/About.js";
import { LiveJourney } from "./pages/LiveJourney.js";
import { Button } from "./components/ui.js";
import { cn } from "./lib/utils.js";

// Primary destinations — shown as top links on desktop and a bottom tab bar on
// mobile. About is not a tab (it's the ⓘ in the header); Sign out lives in
// Settings, not the nav.
const NAV = [
  { href: "/", label: "Map", Icon: MapIcon },
  { href: "/insights", label: "Insights", Icon: BarChart3 },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;

/** Map tab stays highlighted while a journey is running (it lives under Map). */
function useIsActive() {
  const [loc] = useLocation();
  return (href: string) =>
    loc === href || (href === "/" && loc === "/journey");
}

function Header() {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const isActive = useIsActive();

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4">
      <Link href="/" className="flex items-center gap-2">
        <Waves size={20} className="text-brand" />
        <div className="font-serif text-[17px] font-bold tracking-tight">
          Ripple Transit
        </div>
      </Link>

      <nav className="flex items-center gap-1">
        {/* Desktop inline links (mobile uses the bottom tab bar). */}
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "hidden rounded-md px-2.5 py-1.5 text-sm font-medium sm:block",
              isActive(n.href)
                ? "bg-ripple-muted/15 text-[var(--fg)]"
                : "text-ripple-muted hover:text-[var(--fg)]",
            )}
          >
            {n.label}
          </Link>
        ))}

        {/* About, demoted to an info affordance. */}
        <Link href="/about" aria-label="About Ripple Transit" title="About">
          <Button variant="ghost" size="icon">
            <Info size={17} />
          </Button>
        </Link>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </Button>

        {user ? (
          <span className="hidden max-w-[140px] truncate pl-1 text-xs text-ripple-muted md:inline">
            {user.email}
          </span>
        ) : (
          <Link href="/login">
            <Button variant="outline" size="sm" className="ml-1">
              <User size={15} /> Sign in
            </Button>
          </Link>
        )}
      </nav>
    </header>
  );
}

/** Mobile bottom tab bar — Map / Insights / Settings. Hidden on desktop (top
 *  links) and on the full-screen live-journey + login views. */
function BottomTabs() {
  const [loc] = useLocation();
  const isActive = useIsActive();
  if (loc === "/journey" || loc === "/login") return null;
  return (
    <nav className="flex shrink-0 items-stretch border-t border-[var(--border)] bg-[var(--surface)] sm:hidden">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
            isActive(n.href) ? "text-brand" : "text-ripple-muted",
          )}
        >
          <n.Icon size={20} strokeWidth={isActive(n.href) ? 2.4 : 2} />
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

/** The Map tab. While a journey is running it resumes the live companion, so
 *  leaving to another tab and coming back to Map keeps you on the journey (the
 *  journey state lives at the app root, so it never stopped). */
function MapTab() {
  const { journey } = useJourney();
  if (journey && journey.status === "active") return <Redirect to="/journey" />;
  return <Home />;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ripple-muted">
        Loading…
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;
  return <>{children}</>;
}

export function App() {
  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="relative min-h-0 flex-1">
        <Switch>
          <Route path="/" component={MapTab} />
          <Route path="/journey" component={LiveJourney} />
          <Route path="/login" component={Login} />
          <Route path="/about" component={About} />
          {/* Settings absorbed the old Preferences tab + the account/theme/API
              controls; the Favourites component is that merged page. */}
          <Route path="/settings">
            <RequireAuth>
              <Favourites />
            </RequireAuth>
          </Route>
          <Route path="/insights">
            <RequireAuth>
              <Insights />
            </RequireAuth>
          </Route>
          {/* Old tab paths → their merged homes */}
          <Route path="/preferences">
            <Redirect to="/settings" />
          </Route>
          <Route path="/favourites">
            <Redirect to="/settings" />
          </Route>
          <Route path="/saved-locations">
            <Redirect to="/settings" />
          </Route>
          <Route path="/favourite-routes">
            <Redirect to="/settings" />
          </Route>
          <Route path="/impact">
            <Redirect to="/insights" />
          </Route>
          <Route>
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <h1 className="text-xl font-semibold">Page not found</h1>
                <Link
                  href="/"
                  className="mt-4 inline-block text-sm font-medium text-brand hover:underline"
                >
                  ← Back to map
                </Link>
              </div>
            </div>
          </Route>
        </Switch>
      </div>
      <BottomTabs />
    </div>
  );
}
