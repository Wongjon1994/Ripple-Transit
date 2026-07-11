import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

/**
 * Ripple Transit schema (SQLite / libSQL dialect).
 *
 * Adapted from specifications/DATABASE_SCHEMA.md. The spec targets MySQL/TiDB;
 * we run on libSQL (SQLite) locally for zero-setup dev + easy Turso deploy.
 * Semantics are preserved: same tables, columns, constraints, and relationships.
 *
 * Deviations from spec, by design:
 *  - `users.passwordHash` added (email+password auth replaces Manus OAuth).
 *  - `sessions` table added to back cookie sessions.
 *  - MySQL enums become text columns constrained via TypeScript unions ($type).
 */

// ── Table 1: users ────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
});

// ── Auth sessions (backs the httpOnly cookie) ─────────────────
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(), // opaque random token
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ── Table 2: savedLocations ───────────────────────────────────
export const savedLocations = sqliteTable(
  "saved_locations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    address: text("address").notNull(),
    lat: text("lat").notNull(),
    lng: text("lng").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("unique_user_label").on(t.userId, t.label)],
);

// ── Table 3: favouriteRoutes ──────────────────────────────────
export const favouriteRoutes = sqliteTable(
  "favourite_routes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("unique_user_route_label").on(t.userId, t.label)],
);

// ── Table 4: apiUsageCounters ─────────────────────────────────
export const apiUsageCounters = sqliteTable(
  "api_usage_counters",
  {
    service: text("service").notNull(),
    month: text("month").notNull(), // "YYYY-MM" (UTC)
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.service, t.month] })],
);

// ── Table 5: cachedTokens ─────────────────────────────────────
export const cachedTokens = sqliteTable("cached_tokens", {
  service: text("service").primaryKey(), // e.g. "onemap"
  token: text("token").notNull(),
  expiresAt: integer("expires_at").notNull(), // Unix seconds
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
});

// ── Table 6: mrtLineStatuses ──────────────────────────────────
export const mrtLineStatuses = sqliteTable("mrt_line_statuses", {
  lineCode: text("line_code").primaryKey(), // "NS", "EW", "CC", ...
  status: text("status", {
    enum: ["operational", "disrupted", "suspended"],
  })
    .notNull()
    .default("operational"),
  message: text("message"),
  lastUpdated: integer("last_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
});

// ── Table 7: settings ─────────────────────────────────────────
export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    value: text("value"),
  },
  (t) => [uniqueIndex("unique_user_setting").on(t.userId, t.key)],
);

// ── Inferred types ────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type SavedLocation = typeof savedLocations.$inferSelect;
export type FavouriteRoute = typeof favouriteRoutes.$inferSelect;
export type ApiUsageCounter = typeof apiUsageCounters.$inferSelect;
export type CachedToken = typeof cachedTokens.$inferSelect;
export type MrtLineStatus = typeof mrtLineStatuses.$inferSelect;
export type Setting = typeof settings.$inferSelect;

export type UserRole = User["role"];
export type MrtStatus = MrtLineStatus["status"];
