import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "./trpc.js";
import { useAuth } from "./auth.js";
import type { UserPrefs } from "@shared/types.js";

const STORAGE_KEY = "ripple-prefs";

function loadLocal(): UserPrefs {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as UserPrefs;
  } catch {
    return {};
  }
}

/**
 * User preferences (Phase 15): signed-in users sync via tRPC; guests keep the
 * same shape in localStorage. `setPrefs` merges a patch into the current set.
 */
export function usePrefs(): {
  prefs: UserPrefs;
  setPrefs: (patch: Partial<UserPrefs>) => void;
} {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [local, setLocal] = useState<UserPrefs>(loadLocal);

  const server = trpc.prefs.get.useQuery(undefined, {
    enabled: !!user,
    staleTime: 60_000,
  });
  const save = trpc.prefs.set.useMutation({
    // Optimistic: reflect the change instantly; reconcile with the server.
    onMutate: (next) => {
      // The set-input type still carries the legacy "hawker" alias; the server
      // normalizes it to "dining", so it's safe to reflect optimistically.
      utils.prefs.get.setData(undefined, next as UserPrefs);
    },
    onError: (e) => {
      toast.error(`Couldn’t save preferences — ${e.message}`);
      utils.prefs.get.invalidate(); // roll back to the server's truth
    },
    onSuccess: () => utils.prefs.get.invalidate(),
  });

  // First sign-in on this device: seed the account from any guest prefs.
  useEffect(() => {
    if (user && server.data && Object.keys(server.data).length === 0) {
      const guest = loadLocal();
      if (Object.keys(guest).length > 0) save.mutate(guest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, server.data]);

  const prefs = user ? (server.data ?? {}) : local;

  const setPrefs = useCallback(
    (patch: Partial<UserPrefs>) => {
      const next = { ...prefs, ...patch };
      if (user) save.mutate(next);
      else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setLocal(next);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, JSON.stringify(prefs)],
  );

  return { prefs, setPrefs };
}
