import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { weatherAt } from "../services/weather.js";

const coord = z.object({ lat: z.number(), lng: z.number() });

export const weatherRouter = router({
  current: publicProcedure.input(coord).query(({ input }) =>
    weatherAt(input.lat, input.lng),
  ),

  alerts: publicProcedure.input(coord).query(async ({ input }) => {
    const wx = await weatherAt(input.lat, input.lng);
    return { alerts: wx?.advisory ? [wx.advisory] : [] };
  }),
});
