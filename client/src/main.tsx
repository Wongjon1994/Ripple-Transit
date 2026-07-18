import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Toaster } from "sonner";
import { trpc } from "./lib/trpc.js";
import { ThemeProvider } from "./lib/theme.js";
import { AuthProvider } from "./lib/auth.js";
import { JourneyProvider } from "./lib/journey.js";
import { SearchSessionProvider } from "./lib/searchSession.js";
import { App } from "./App.js";
import "./index.css";

function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          fetch: (url, opts) =>
            fetch(url, { ...opts, credentials: "include" }),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <JourneyProvider>
              <SearchSessionProvider>
                <App />
                <Toaster position="top-center" richColors />
              </SearchSessionProvider>
            </JourneyProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
