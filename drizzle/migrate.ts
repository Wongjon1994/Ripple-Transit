import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db, libsql } from "../server/db/index.js";
import { env } from "../server/env.js";

// For a local `file:` database, make sure the parent directory exists.
if (env.DATABASE_URL.startsWith("file:")) {
  const path = env.DATABASE_URL.replace(/^file:/, "");
  mkdirSync(dirname(path), { recursive: true });
}

async function main() {
  console.log("Running migrations against", env.DATABASE_URL);
  await migrate(db, { migrationsFolder: "./drizzle/migrations" });
  console.log("✓ Migrations applied");
  libsql.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
