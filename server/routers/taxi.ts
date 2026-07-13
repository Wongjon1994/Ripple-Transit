import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { taxiEstimate } from "../services/taxi.js";

const coord = z.object({ lat: z.number(), lng: z.number() });

export const taxiRouter = router({
  estimate: publicProcedure
    .input(z.object({ origin: coord, destination: coord }))
    .query(({ input }) => taxiEstimate(input.origin, input.destination)),
});
