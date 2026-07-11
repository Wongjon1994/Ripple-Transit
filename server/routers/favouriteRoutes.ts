import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import {
  listFavouriteRoutes,
  addFavouriteRoute,
  renameFavouriteRoute,
  deleteFavouriteRoute,
} from "../db/helpers.js";

export const favouriteRoutesRouter = router({
  list: protectedProcedure.query(({ ctx }) => listFavouriteRoutes(ctx.user.id)),

  add: protectedProcedure
    .input(
      z.object({
        label: z.string().min(1).max(128),
        origin: z.string().min(1).max(255),
        destination: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await addFavouriteRoute(
        ctx.user.id,
        input.label,
        input.origin,
        input.destination,
      );
      return { success: true as const };
    }),

  rename: protectedProcedure
    .input(z.object({ id: z.number(), label: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      await renameFavouriteRoute(input.id, ctx.user.id, input.label);
      return { success: true as const };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteFavouriteRoute(input.id, ctx.user.id);
      return { success: true as const };
    }),
});
