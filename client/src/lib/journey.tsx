import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import type { Itinerary, LatLng } from "@shared/types.js";

export interface ActiveJourney {
  itinerary: Itinerary;
  originText: string;
  destText: string;
  origin: LatLng;
  destination: LatLng;
  startedAt: number; // ms
  currentLeg: number; // index into itinerary.legs
  status: "active" | "completed";
  completedAt?: number;
}

interface JourneyCtx {
  journey: ActiveJourney | null;
  start: (j: Omit<ActiveJourney, "startedAt" | "currentLeg" | "status">) => void;
  advance: () => void;
  back: () => void;
  complete: () => void;
  end: () => void;
}

const Ctx = createContext<JourneyCtx | null>(null);

export function JourneyProvider({ children }: { children: ReactNode }) {
  const [journey, setJourney] = useState<ActiveJourney | null>(null);

  const start: JourneyCtx["start"] = (j) =>
    setJourney({
      ...j,
      startedAt: Date.now(),
      currentLeg: 0,
      status: "active",
    });

  const advance = () =>
    setJourney((j) => {
      if (!j) return j;
      const nextLeg = j.currentLeg + 1;
      if (nextLeg >= j.itinerary.legs.length) {
        return { ...j, status: "completed", completedAt: Date.now() };
      }
      return { ...j, currentLeg: nextLeg };
    });

  const back = () =>
    setJourney((j) =>
      j ? { ...j, currentLeg: Math.max(0, j.currentLeg - 1) } : j,
    );

  const complete = () =>
    setJourney((j) =>
      j ? { ...j, status: "completed", completedAt: Date.now() } : j,
    );

  const end = () => setJourney(null);

  return (
    <Ctx.Provider value={{ journey, start, advance, back, complete, end }}>
      {children}
    </Ctx.Provider>
  );
}

export function useJourney() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useJourney must be used within JourneyProvider");
  return ctx;
}
