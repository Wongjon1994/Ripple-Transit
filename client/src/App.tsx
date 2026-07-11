import { Route, Switch, Link, useLocation } from "wouter";
import { Moon, Sun, Waves } from "lucide-react";
import { useTheme } from "./lib/theme.js";
import { Home } from "./pages/Home.js";
import { Button } from "./components/ui.js";
import { cn } from "./lib/utils.js";

function Header() {
  const { theme, toggleTheme } = useTheme();
  const [loc] = useLocation();

  const nav = [
    { href: "/", label: "Map" },
    { href: "/saved-locations", label: "Saved" },
    { href: "/favourite-routes", label: "Routes" },
    { href: "/settings", label: "Settings" },
  ];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4">
      <Link href="/" className="flex items-center gap-2">
        <Waves size={20} className="text-bus" />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold">Ripple Transit</div>
          <div className="hidden text-[10px] uppercase tracking-wide text-ripple-muted sm:block">
            Urban mobility intelligence · Singapore
          </div>
        </div>
      </Link>

      <nav className="flex items-center gap-1">
        {nav.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm font-medium",
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
          className="ml-1"
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </Button>
      </nav>
    </header>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-ripple-muted">
          This page arrives in a later phase.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm font-medium text-bus hover:underline"
        >
          ← Back to map
        </Link>
      </div>
    </div>
  );
}

export function App() {
  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="min-h-0 flex-1">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/saved-locations">
            <Placeholder title="Saved Locations" />
          </Route>
          <Route path="/favourite-routes">
            <Placeholder title="Favourite Routes" />
          </Route>
          <Route path="/settings">
            <Placeholder title="Settings" />
          </Route>
          <Route>
            <Placeholder title="Page not found" />
          </Route>
        </Switch>
      </div>
    </div>
  );
}
