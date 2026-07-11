import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import cors from "cors";
import * as trpcExpress from "@trpc/server/adapters/express";
import { env, isProd } from "./env.js";
import { appRouter } from "./routers/index.js";
import { createContext } from "./context.js";

const app = express();

app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  }),
);

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

// In production, serve the built client.
if (isProd) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const clientDir = resolve(__dirname, "../dist/client");
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get("*", (_req, res) => {
      res.sendFile(resolve(clientDir, "index.html"));
    });
  }
}

app.listen(env.PORT, () => {
  console.log(`▲ Ripple Transit API on http://localhost:${env.PORT}`);
});
