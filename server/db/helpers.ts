import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./index.js";
import {
  users,
  sessions,
  savedLocations,
  favouriteRoutes,
  apiUsageCounters,
  cachedTokens,
  mrtLineStatuses,
  settings,
  tripLog,
  type UserRole,
  type MrtStatus,
} from "../../drizzle/schema.js";

// ── Helpers ───────────────────────────────────────────────────
/** Current month as "YYYY-MM" in UTC — the partition key for usage counters. */
export function currentMonth(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// ── Users ─────────────────────────────────────────────────────
export async function getUserById(id: number) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getUserByEmail(email: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function createUser(
  email: string,
  passwordHash: string,
  role: UserRole = "user",
) {
  const rows = await db
    .insert(users)
    .values({ email: email.toLowerCase(), passwordHash, role })
    .returning();
  return rows[0];
}

// ── Sessions ──────────────────────────────────────────────────
export async function createSession(
  id: string,
  userId: number,
  expiresAt: Date,
) {
  await db.insert(sessions).values({ id, userId, expiresAt });
}

export async function getSessionWithUser(id: string) {
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteSession(id: string) {
  await db.delete(sessions).where(eq(sessions.id, id));
}

// ── Saved locations ───────────────────────────────────────────
export async function getSavedLocations(userId: number) {
  return db
    .select()
    .from(savedLocations)
    .where(eq(savedLocations.userId, userId))
    .orderBy(savedLocations.createdAt);
}

export async function addSavedLocation(
  userId: number,
  label: string,
  address: string,
  lat: string,
  lng: string,
) {
  const rows = await db
    .insert(savedLocations)
    .values({ userId, label, address, lat, lng })
    .returning();
  return rows[0];
}

export async function updateSavedLocationLabel(
  id: number,
  userId: number,
  label: string,
) {
  await db
    .update(savedLocations)
    .set({ label })
    .where(and(eq(savedLocations.id, id), eq(savedLocations.userId, userId)));
}

export async function deleteSavedLocation(id: number, userId: number) {
  await db
    .delete(savedLocations)
    .where(and(eq(savedLocations.id, id), eq(savedLocations.userId, userId)));
}

// ── Favourite routes ──────────────────────────────────────────
export async function listFavouriteRoutes(userId: number) {
  return db
    .select()
    .from(favouriteRoutes)
    .where(eq(favouriteRoutes.userId, userId))
    .orderBy(favouriteRoutes.createdAt);
}

export async function addFavouriteRoute(
  userId: number,
  label: string,
  origin: string,
  destination: string,
) {
  const rows = await db
    .insert(favouriteRoutes)
    .values({ userId, label, origin, destination })
    .returning();
  return rows[0];
}

export async function renameFavouriteRoute(
  id: number,
  userId: number,
  label: string,
) {
  await db
    .update(favouriteRoutes)
    .set({ label })
    .where(and(eq(favouriteRoutes.id, id), eq(favouriteRoutes.userId, userId)));
}

export async function deleteFavouriteRoute(id: number, userId: number) {
  await db
    .delete(favouriteRoutes)
    .where(and(eq(favouriteRoutes.id, id), eq(favouriteRoutes.userId, userId)));
}

// ── API usage counters ────────────────────────────────────────
export async function getApiUsageCount(service: string): Promise<number> {
  const month = currentMonth();
  const rows = await db
    .select()
    .from(apiUsageCounters)
    .where(
      and(
        eq(apiUsageCounters.service, service),
        eq(apiUsageCounters.month, month),
      ),
    )
    .limit(1);
  return rows[0]?.count ?? 0;
}

/** Atomically increment (and return) this month's usage count for a service. */
export async function incrementApiUsage(
  service: string,
  by = 1,
): Promise<number> {
  const month = currentMonth();
  const rows = await db
    .insert(apiUsageCounters)
    .values({ service, month, count: by })
    .onConflictDoUpdate({
      target: [apiUsageCounters.service, apiUsageCounters.month],
      set: { count: sql`${apiUsageCounters.count} + ${by}` },
    })
    .returning();
  return rows[0]?.count ?? by;
}

// ── Cached tokens ─────────────────────────────────────────────
export async function getCachedToken(service: string) {
  const rows = await db
    .select()
    .from(cachedTokens)
    .where(eq(cachedTokens.service, service))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertCachedToken(
  service: string,
  token: string,
  expiresAt: number,
) {
  await db
    .insert(cachedTokens)
    .values({ service, token, expiresAt })
    .onConflictDoUpdate({
      target: cachedTokens.service,
      set: { token, expiresAt, updatedAt: new Date() },
    });
}

// ── MRT statuses ──────────────────────────────────────────────
export async function getMrtLineStatus(lineCode: string) {
  const rows = await db
    .select()
    .from(mrtLineStatuses)
    .where(eq(mrtLineStatuses.lineCode, lineCode))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAllLineStatuses() {
  return db.select().from(mrtLineStatuses).orderBy(mrtLineStatuses.lineCode);
}

export async function updateMrtLineStatus(
  lineCode: string,
  status: MrtStatus,
  message?: string | null,
) {
  await db
    .insert(mrtLineStatuses)
    .values({ lineCode, status, message: message ?? null })
    .onConflictDoUpdate({
      target: mrtLineStatuses.lineCode,
      set: { status, message: message ?? null, lastUpdated: new Date() },
    });
}

// ── Settings ──────────────────────────────────────────────────
export async function getSetting(
  key: string,
  userId: number | null = null,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.key, key),
        userId === null
          ? sql`${settings.userId} is null`
          : eq(settings.userId, userId),
      ),
    )
    .limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(
  key: string,
  value: string,
  userId: number | null = null,
) {
  await db
    .insert(settings)
    .values({ key, value, userId })
    .onConflictDoUpdate({
      target: [settings.userId, settings.key],
      set: { value },
    });
}

// ── Trip log (sustainability) ─────────────────────────────────
export async function addTripLog(entry: {
  userId: number;
  origin: string;
  destination: string;
  mode: "transit" | "taxi" | "car" | "walk" | "cycle";
  co2Grams: number;
  savedGrams: number;
  distanceM: number;
}): Promise<number> {
  // NB: `.returning()` fails against Turso's HTTP libSQL (works on the local
  // file driver), so read the autoincrement id from lastInsertRowid instead.
  const res = await db.insert(tripLog).values(entry);
  const rowid = (res as { lastInsertRowid?: bigint | number }).lastInsertRowid;
  return rowid != null ? Number(rowid) : 0;
}

/** Update a trip log the user owns — used by the live "log as I go" flow. */
export async function updateTripLog(
  userId: number,
  id: number,
  patch: { co2Grams: number; savedGrams: number; distanceM: number },
) {
  await db
    .update(tripLog)
    .set(patch)
    .where(and(eq(tripLog.id, id), eq(tripLog.userId, userId)));
}

/** Aggregate a user's trips since a cutoff date. */
export async function getTripStats(userId: number, since: Date) {
  const rows = await db
    .select()
    .from(tripLog)
    .where(and(eq(tripLog.userId, userId), gte(tripLog.createdAt, since)));
  return {
    trips: rows.length,
    totalCo2Grams: rows.reduce((s, r) => s + r.co2Grams, 0),
    totalSavedGrams: rows.reduce((s, r) => s + r.savedGrams, 0),
    totalDistanceM: rows.reduce((s, r) => s + r.distanceM, 0),
  };
}
