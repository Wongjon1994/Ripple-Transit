import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import cors from "cors";
import * as trpcExpress from "@trpc/server/adapters/express";
import { env, isProd } from "./env.js";
import { appRouter } from "./routers/index.js";
import { createContext } from "./context.js";
import { warmBusRouteIndex } from "./services/lta.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

async function main() {
  const app = express();

  // Render (and most PaaS) terminate TLS at a proxy; trust it so secure
  // cookies and req.protocol behave correctly.
  if (isProd) app.set("trust proxy", 1);

  // Guard against deploying with an unconfigured database: a local file DB in
  // production means DATABASE_URL/DATABASE_AUTH_TOKEN weren't set, and every
  // DB query will fail. Fail loudly at boot instead of silently 500-ing.
  if (isProd && env.DATABASE_URL.startsWith("file:")) {
    console.error(
      "\n✖ DATABASE_URL is a local file in production.\n" +
        "  Set DATABASE_URL (libsql://…) and DATABASE_AUTH_TOKEN to your Turso DB.\n",
    );
  }

  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    }),
  );

  // ── API ─────────────────────────────────────────────────────
  app.use(
    "/api/trpc",
    trpcExpress.createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, env: env.NODE_ENV });
  });

  // ── Client ──────────────────────────────────────────────────
  if (isProd) {
    // Serve the built client.
    const clientDir = resolve(rootDir, "dist/client");
    if (existsSync(clientDir)) {
      app.use(express.static(clientDir));
      app.get("*", (_req, res) =>
        res.sendFile(resolve(clientDir, "index.html")),
      );
    }
  } else {
    // Dev: mount Vite in middleware mode so one port serves API + client
    // with hot module replacement, same-origin (no proxy).
    const { createServer } = await import("vite");
    const vite = await createServer({
      configFile: resolve(rootDir, "vite.config.ts"),
      root: resolve(rootDir, "client"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(env.PORT, () => {
    console.log(
      `▲ Ripple Transit on http://localhost:${env.PORT} (${env.NODE_ENV})`,
    );
    // Pre-load the bus-route connectivity index so the first route request
    // isn't slowed by fetching ~26k route rows.
    warmBusRouteIndex();
  });
}

main().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
