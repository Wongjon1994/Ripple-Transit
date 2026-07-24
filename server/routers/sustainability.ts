import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import {
  addTripLog,
  updateTripLog,
  getTripStats,
  getTripsBetween,
} from "../db/helpers.js";
import { equivalents } from "../services/sustainability.js";
import { tripInsights } from "../services/tripInsights.js";

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

  /**
   * Personalised insights (Phase 16) over a rolling 30-day window, compared
   * against the 30 days before it. A rolling window rather than the calendar
   * month the Impact tiles use: on the 1st of a month there is nothing to say.
   */
  insights: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
    const since = new Date(now.getTime() - WINDOW_MS);
    const priorSince = new Date(since.getTime() - WINDOW_MS);
    const [trips, prior] = await Promise.all([
      getTripsBetween(ctx.user.id, since, now),
      getTripsBetween(ctx.user.id, priorSince, since),
    ]);
    return { windowDays: 30, ...tripInsights(trips, prior, now) };
  }),
});
