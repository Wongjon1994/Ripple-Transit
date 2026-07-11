import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import cors from "cors";
import * as trpcExpress from "@trpc/server/adapters/express";
import { env, isProd } from "./env.js";
import { appRouter } from "./routers/index.js";
import { createContext } from "./context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

async function main() {
  const app = express();

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
  });
}

main().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
