import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";
export type ThemeMode = "auto" | "light" | "dark";

interface ThemeCtx {
  /** The user's chosen preference. "auto" follows time of day. */
  mode: ThemeMode;
  /** The effective, resolved theme actually applied to the document. */
  theme: Theme;
  setMode: (mode: ThemeMode) => void;
  /** Header button: cycles auto → light → dark → auto. */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

const STORAGE_KEY = "ripple-theme";

/**
 * Effective theme for "auto": Singapore is equatorial (sunrise ~7am / sunset
 * ~7pm year-round), so fixed local hours track daylight accurately without a
 * sunrise API. Dark 19:00–06:59, light 07:00–18:59.
 */
function autoTheme(now = new Date()): Theme {
  const hour = now.getHours();
  return hour >= 19 || hour < 7 ? "dark" : "light";
}

function loadMode(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "auto" || saved === "light" || saved === "dark") return saved;
  return "auto";
}

function resolve(mode: ThemeMode): Theme {
  return mode === "auto" ? autoTheme() : mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(loadMode);
  const [theme, setTheme] = useState<Theme>(() => resolve(loadMode()));

  // Apply + persist whenever the mode changes, and — while in auto — re-check on
  // an interval and on focus so the theme flips at dawn/dusk without a reload.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    const apply = () => setTheme(resolve(mode));
    apply();
    if (mode !== "auto") return;

    const id = window.setInterval(apply, 5 * 60 * 1000);
    window.addEventListener("focus", apply);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", apply);
    };
  }, [mode]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setMode = (m: ThemeMode) => setModeState(m);
  const toggleTheme = () =>
    setModeState((m) =>
      m === "auto" ? "light" : m === "light" ? "dark" : "auto",
    );

  return (
    <ThemeContext.Provider value={{ mode, theme, setMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
