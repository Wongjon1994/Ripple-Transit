import { Route, Switch, Link, useLocation, Redirect } from "wouter";
import { Moon, Sun, Waves, LogOut, User, Menu, X } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect, type ReactNode } from "react";
import { useTheme } from "./lib/theme.js";
import { useAuth } from "./lib/auth.js";
import { trpc } from "./lib/trpc.js";
import { Home } from "./pages/Home.js";
import { Login } from "./pages/Login.js";
import { Favourites } from "./pages/Favourites.js";
import { Insights } from "./pages/Insights.js";
import { About } from "./pages/About.js";
import { LiveJourney } from "./pages/LiveJourney.js";
import { Settings } from "./pages/Settings.js";
import { Button } from "./components/ui.js";
import { cn } from "./lib/utils.js";

function Header() {
  const { theme, toggleTheme } = useTheme();
  const { user, refetch } = useAuth();
  const [loc] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const utils = trpc.useUtils();

  // Close the mobile menu on navigation.
  useEffect(() => setMenuOpen(false), [loc]);

  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      refetch();
      toast.success("Signed out.");
    },
  });

  const nav = [
    { href: "/", label: "Map" },
    { href: "/preferences", label: "Preferences" },
    { href: "/insights", label: "Insights" },
    { href: "/about", label: "About" },
    { href: "/settings", label: "Settings" },
  ];

  return (
    <header className="relative flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4">
      <Link href="/" className="flex items-center gap-2">
        <Waves size={20} className="text-brand" />
        <div className="leading-tight">
          <div className="font-serif text-[17px] font-bold tracking-tight">
            Ripple Transit
          </div>
          <div className="eyebrow hidden text-[9px] text-ripple-muted sm:block">
            Urban mobility intelligence · Singapore
          </div>
        </div>
      </Link>

      <nav className="flex items-center gap-1">
        {/* Desktop inline links */}
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "hidden rounded-md px-2.5 py-1.5 text-sm font-medium sm:block",
              loc === n.href
                ? "bg-ripple-muted/15 text-[var(--fg)]"
                : "text-ripple-muted hover:text-[var(--fg)]",
            )}
          >
            {n.label}
          </Link>
        ))}

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </Button>

        {user ? (
          <div className="flex items-center gap-1.5 pl-1">
            <span className="hidden max-w-[140px] truncate text-xs text-ripple-muted md:inline">
              {user.email}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={() => logout.mutate()}
              className="hidden sm:inline-flex"
            >
              <LogOut size={16} />
            </Button>
          </div>
        ) : (
          <Link href="/login" className="hidden sm:block">
            <Button variant="outline" size="sm" className="ml-1">
              <User size={15} /> Sign in
            </Button>
          </Link>
        )}

        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </Button>
      </nav>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 top-14 z-[900] bg-black/20 sm:hidden"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-2 top-full z-[901] mt-1 w-52 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl sm:hidden">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "block px-4 py-2.5 text-sm font-medium",
                  loc === n.href
                    ? "bg-ripple-muted/15 text-[var(--fg)]"
                    : "text-[var(--fg)] hover:bg-ripple-muted/10",
                )}
              >
                {n.label}
              </Link>
            ))}
            <div className="border-t border-[var(--border)]">
              {user ? (
                <button
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-error hover:bg-ripple-muted/10"
                  onClick={() => {
                    setMenuOpen(false);
                    logout.mutate();
                  }}
                >
                  <LogOut size={15} /> Sign out
                </button>
              ) : (
                <Link
                  href="/login"
                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-brand hover:bg-ripple-muted/10"
                >
                  <User size={15} /> Sign in
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </header>
  );
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
      <div className="min-h-0 flex-1">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/journey" component={LiveJourney} />
          <Route path="/login" component={Login} />
          <Route path="/about" component={About} />
          <Route path="/preferences">
            <RequireAuth>
              <Favourites />
            </RequireAuth>
          </Route>
          <Route path="/favourites">
            <Redirect to="/preferences" />
          </Route>
          <Route path="/insights">
            <RequireAuth>
              <Insights />
            </RequireAuth>
          </Route>
          {/* Old tab paths → their merged homes */}
          <Route path="/saved-locations">
            <Redirect to="/preferences" />
          </Route>
          <Route path="/favourite-routes">
            <Redirect to="/preferences" />
          </Route>
          <Route path="/impact">
            <Redirect to="/insights" />
          </Route>
          <Route path="/settings">
            <RequireAuth>
              <Settings />
            </RequireAuth>
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
    </div>
  );
}
