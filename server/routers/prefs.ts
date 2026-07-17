import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { db } from "../db/index.js";
import { userPrefs } from "../../drizzle/schema.js";
import type { UserPrefs } from "../../shared/types.js";

// "hawker" accepted as a legacy alias for "dining" (saved prefs survive §2a).
const chipSchema = z
  .enum([
    "dining",
    "hawker",
    "clinic",
    "supermarket",
    "park",
    "library",
    "sports",
    "atm",
    "attraction",
  ])
  .transform((c) => (c === "hawker" ? ("dining" as const) : c));

const prefsSchema = z.object({
  defaultChips: z.array(chipSchema).length(4).optional(),
  maxWalkMin: z.union([z.literal(10), z.literal(15), z.literal(20)]).optional(),
  supermarketBrands: z.array(z.string().max(40)).max(10).optional(),
  atmBanks: z.array(z.string().max(40)).max(10).optional(),
});

export const prefsRouter = router({
  get: protectedProcedure.query(async ({ ctx }): Promise<UserPrefs> => {
    try {
      const row = await db.query.userPrefs.findFirst({
        where: eq(userPrefs.userId, ctx.user.id),
      });
      if (!row) return {};
      // Cast through unknown: the zod transform narrows legacy "hawker" → the
      // "dining" it can't statically prove equals NearestCategoryId.
      return prefsSchema.parse(JSON.parse(row.prefs)) as unknown as UserPrefs;
    } catch {
      // Missing table (failed migration) or malformed blob — defaults, not a 500.
      return {};
    }
  }),

  set: protectedProcedure
    .input(prefsSchema)
    .mutation(async ({ ctx, input }) => {
      await db
        .insert(userPrefs)
        .values({ userId: ctx.user.id, prefs: JSON.stringify(input) })
        .onConflictDoUpdate({
          target: userPrefs.userId,
          set: { prefs: JSON.stringify(input), updatedAt: new Date() },
        });
      return { ok: true };
    }),
});
