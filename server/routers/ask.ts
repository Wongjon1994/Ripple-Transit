import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc.js";
import { parseAsk, AskNotConfiguredError } from "../services/askRipple.js";

/**
 * Ask Ripple — the natural-language layer. `parse` turns a sentence into a
 * structured route intent; the client then geocodes and runs the SAME search as
 * a manual From/To entry. `configured` lets the client hide the input entirely
 * when no API key is set (the manual flow is untouched).
 */
export const askRouter = router({
  configured: publicProcedure.query(() => ({
    enabled: !!process.env.ANTHROPIC_API_KEY,
  })),

  parse: publicProcedure
    .input(z.object({ query: z.string().trim().min(1).max(280) }))
    .mutation(async ({ input }) => {
      try {
        return await parseAsk(input.query);
      } catch (err) {
        if (err instanceof AskNotConfiguredError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Ask Ripple isn't set up on this server.",
          });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Couldn't understand that — try rephrasing, or use the fields below.",
        });
      }
    }),
});
