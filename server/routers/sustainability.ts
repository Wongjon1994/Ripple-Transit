import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { addTripLog, updateTripLog, getTripStats } from "../db/helpers.js";
import { equivalents } from "../services/sustainability.js";

export const sustainabilityRouter = router({
  logTrip: protectedProcedure
    .input(
      z.object({
        origin: z.string().max(255),
        destination: z.string().max(255),
        mode: z
          .enum(["transit", "taxi", "car", "walk", "cycle"])
          .default("transit"),
        co2Grams: z.number().int().nonnegative(),
        savedGrams: z.number().int().default(0),
        distanceM: z.number().int().nonnegative().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = await addTripLog({ userId: ctx.user.id, ...input });
      return { success: true as const, id };
    }),

  /** Update a log created mid-journey as more progress accrues (re-routes etc). */
  updateTrip: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        co2Grams: z.number().int().nonnegative(),
        savedGrams: z.number().int().default(0),
        distanceM: z.number().int().nonnegative().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      await updateTripLog(ctx.user.id, id, patch);
      return { success: true as const };
    }),

  /** This calendar month's totals + friendly equivalents. */
  stats: protectedProcedure.query(async ({ ctx }) => {
    const since = new Date();
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
    const s = await getTripStats(ctx.user.id, since);
    return { ...s, equivalents: equivalents(s.totalSavedGrams) };
  }),
});
