import { createContext, useContext, useRef, type ReactNode } from "react";
import type { LatLng } from "@shared/types.js";

/** Everything needed to restore the Map screen's search + results after the
 *  user navigates to another tab or exits the live journey. Held in memory at
 *  the app root, so it survives Home unmounting/remounting within the session
 *  (but not a full page reload — that's fine for tab navigation). */
export interface SearchSnapshot {
  fromText: string;
  from: LatLng | null;
  stops: { text: string; point: LatLng | null }[];
  date: string;
  time: string;
  timeIsAuto: boolean;
  modeTab: "transit" | "walk" | "cycle";
  selected: number;
  activeSel: number;
  routeParams: {
    points: LatLng[];
    date: string;
    time: string;
    destName?: string;
  } | null;
}

const Ctx = createContext<{
  get: () => SearchSnapshot | null;
  set: (s: SearchSnapshot | null) => void;
} | null>(null);

export function SearchSessionProvider({ children }: { children: ReactNode }) {
  // A ref, not state: writing the snapshot must not re-render the whole app.
  const ref = useRef<SearchSnapshot | null>(null);
  const api = useRef({
    get: () => ref.current,
    set: (s: SearchSnapshot | null) => {
      ref.current = s;
    },
  });
  return <Ctx.Provider value={api.current}>{children}</Ctx.Provider>;
}

export function useSearchSession() {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useSearchSession must be used within SearchSessionProvider");
  return ctx;
}
