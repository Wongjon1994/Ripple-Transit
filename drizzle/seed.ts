import bcrypt from "bcryptjs";
import { db, libsql } from "../server/db/index.js";
import { users, mrtLineStatuses } from "./schema.js";
import { getUserByEmail } from "../server/db/helpers.js";
import { isProd } from "../server/env.js";

const MRT_LINES: { lineCode: string; message?: string }[] = [
  { lineCode: "NS" }, // North-South
  { lineCode: "EW" }, // East-West
  { lineCode: "NE" }, // North East
  { lineCode: "CC" }, // Circle
  { lineCode: "DT" }, // Downtown
  { lineCode: "TE" }, // Thomson-East Coast
];

const DEV_EMAIL = "dev@ripple.transit";
const DEV_PASSWORD = "password123";

async function main() {
  // Seed MRT line statuses (idempotent).
  for (const line of MRT_LINES) {
    await db
      .insert(mrtLineStatuses)
      .values({ lineCode: line.lineCode, status: "operational" })
      .onConflictDoNothing();
  }
  console.log(`✓ Seeded ${MRT_LINES.length} MRT lines`);

  // Seed a dev user (admin) so protected features work immediately — but never
  // in production (no default admin account in a live deployment).
  if (isProd) {
    console.log("• Skipping dev user (NODE_ENV=production)");
  } else {
    const existing = await getUserByEmail(DEV_EMAIL);
    if (!existing) {
      const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
      await db
        .insert(users)
        .values({ email: DEV_EMAIL, passwordHash, role: "admin" });
      console.log(`✓ Created dev user  →  ${DEV_EMAIL} / ${DEV_PASSWORD}`);
    } else {
      console.log(`• Dev user already exists (${DEV_EMAIL})`);
    }
  }

  libsql.close();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
