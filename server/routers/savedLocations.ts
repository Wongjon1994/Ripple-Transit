import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import {
  getSavedLocations,
  addSavedLocation,
  updateSavedLocationLabel,
  deleteSavedLocation,
} from "../db/helpers.js";

export const savedLocationsRouter = router({
  list: protectedProcedure.query(({ ctx }) => getSavedLocations(ctx.user.id)),

  add: protectedProcedure
    .input(
      z.object({
        label: z.string().min(1).max(128),
        address: z.string().min(1).max(255),
        lat: z.string(),
        lng: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await addSavedLocation(
        ctx.user.id,
        input.label,
        input.address,
        input.lat,
        input.lng,
      );
      return { success: true as const };
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.number(), label: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      await updateSavedLocationLabel(input.id, ctx.user.id, input.label);
      return { success: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteSavedLocation(input.id, ctx.user.id);
      return { success: true as const };
    }),
});
