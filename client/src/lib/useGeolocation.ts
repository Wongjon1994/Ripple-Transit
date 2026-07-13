import { useEffect, useState } from "react";
import type { LatLng } from "@shared/types.js";

export interface GeoState {
  position: LatLng | null;
  accuracy: number | null;
  error: string | null;
  supported: boolean;
}

/** Live device position via the browser Geolocation API. */
export function useGeolocation(enabled: boolean): GeoState {
  const supported = typeof navigator !== "undefined" && !!navigator.geolocation;
  const [state, setState] = useState<GeoState>({
    position: null,
    accuracy: null,
    error: null,
    supported,
  });

  useEffect(() => {
    if (!enabled || !supported) return;
    const id = navigator.geolocation.watchPosition(
      (pos) =>
        setState({
          position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          accuracy: pos.coords.accuracy,
          error: null,
          supported,
        }),
      (err) =>
        setState((s) => ({
          ...s,
          error:
            err.code === err.PERMISSION_DENIED
              ? "Location permission denied"
              : "Couldn't get your location",
        })),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, supported]);

  return state;
}
