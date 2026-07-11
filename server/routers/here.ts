import { router, publicProcedure } from "../trpc.js";
import { hereUsageStats } from "../services/here.js";

export const hereRouter = router({
  usageStats: publicProcedure.query(() => hereUsageStats()),
});
