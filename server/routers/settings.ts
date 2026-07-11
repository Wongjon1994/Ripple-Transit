import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import { getSetting, setSetting } from "../db/helpers.js";

export const settingsRouter = router({
  get: protectedProcedure
    .input(z.object({ key: z.string().min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const value = await getSetting(input.key, ctx.user.id);
      return { value };
    }),

  set: protectedProcedure
    .input(z.object({ key: z.string().min(1).max(100), value: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await setSetting(input.key, input.value, ctx.user.id);
      return { success: true as const };
    }),
});
