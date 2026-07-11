import { createContext, useContext, type ReactNode } from "react";
import { trpc } from "./trpc.js";

export interface AuthUser {
  id: number;
  email: string;
  role: "user" | "admin";
}

interface AuthCtx {
  user: AuthUser | null;
  isLoading: boolean;
  refetch: () => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const me = trpc.auth.me.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });

  return (
    <AuthContext.Provider
      value={{
        user: (me.data as AuthUser | null) ?? null,
        isLoading: me.isLoading,
        refetch: () => me.refetch(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
