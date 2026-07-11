import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env.js";
import * as schema from "../../drizzle/schema.js";

// For a local `file:` database, ensure the parent directory exists before the
// driver tries to open the file (otherwise libSQL throws SQLITE_CANTOPEN).
if (env.DATABASE_URL.startsWith("file:")) {
  const path = env.DATABASE_URL.replace(/^file:/, "");
  mkdirSync(dirname(path), { recursive: true });
}

// A local `file:` URL points at a SQLite file; a `libsql://` URL points at
// Turso (cloud). Same driver, so local dev and prod share one code path.
export const libsql = createClient({
  url: env.DATABASE_URL,
  authToken: env.DATABASE_AUTH_TOKEN,
});

export const db = drizzle(libsql, { schema });

export { schema };
export type DB = typeof db;
