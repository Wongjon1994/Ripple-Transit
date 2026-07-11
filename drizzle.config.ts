import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./data/ripple.db",
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  },
  verbose: true,
  strict: true,
});
