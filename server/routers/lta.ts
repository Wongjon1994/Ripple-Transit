import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { busArrivals, getAllBusStops, nearbyStops } from "../services/lta.js";

export const ltaRouter = router({
  busArrivals: publicProcedure
    .input(
      z.object({
        busStopCode: z.string().min(1),
        serviceNo: z.string().optional(),
      }),
    )
    .query(({ input }) => busArrivals(input.busStopCode, input.serviceNo)),

  busStops: publicProcedure.query(() => getAllBusStops()),

  nearbyStops: publicProcedure
    .input(
      z.object({
        lat: z.number(),
        lng: z.number(),
        radius: z.number().min(50).max(2000).default(400),
      }),
    )
    .query(({ input }) => nearbyStops(input.lat, input.lng, input.radius)),
});
