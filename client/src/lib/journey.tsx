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
  /** Impact-log row id once the user starts logging this journey (live flow). */
  logId?: number | null;
  /** Distance / carbon completed on PRIOR itineraries before re-routes, so the
   *  log's cumulative value survives a mid-journey re-route. */
  bankedM?: number;
  bankedCo2?: number;
  bankedSaved?: number;
}

type StartInput = Omit<ActiveJourney, "startedAt" | "currentLeg" | "status">;

interface JourneyCtx {
  journey: ActiveJourney | null;
  start: (j: StartInput) => void;
  advance: () => void;
  back: () => void;
  complete: () => void;
  end: () => void;
  /** Store the impact-log row id (live "log as I go" flow). */
  setLogId: (id: number) => void;
  /** Re-route mid-journey, banking the completed distance/carbon so the log
   *  keeps a correct cumulative total across the switch. */
  reroute: (
    j: StartInput,
    banked: { m: number; co2: number; saved: number },
  ) => void;
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
      logId: null,
      bankedM: 0,
      bankedCo2: 0,
      bankedSaved: 0,
    });

  const setLogId: JourneyCtx["setLogId"] = (id) =>
    setJourney((j) => (j ? { ...j, logId: id } : j));

  const reroute: JourneyCtx["reroute"] = (j, banked) =>
    setJourney((prev) => ({
      ...j,
      startedAt: prev?.startedAt ?? Date.now(),
      currentLeg: 0,
      status: "active",
      logId: prev?.logId ?? null,
      bankedM: (prev?.bankedM ?? 0) + banked.m,
      bankedCo2: (prev?.bankedCo2 ?? 0) + banked.co2,
      bankedSaved: (prev?.bankedSaved ?? 0) + banked.saved,
    }));

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
    <Ctx.Provider
      value={{ journey, start, advance, back, complete, end, setLogId, reroute }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useJourney() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useJourney must be used within JourneyProvider");
  return ctx;
}
