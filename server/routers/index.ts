import { router, publicProcedure } from "../trpc.js";
import { authRouter } from "./auth.js";
import { onemapRouter } from "./onemap.js";
import { activeRouter } from "./active.js";
import { ltaRouter } from "./lta.js";
import { mrtRouter } from "./mrt.js";
import { hereRouter } from "./here.js";
import { weatherRouter } from "./weather.js";
import { taxiRouter } from "./taxi.js";
import { sustainabilityRouter } from "./sustainability.js";
import { savedLocationsRouter } from "./savedLocations.js";
import { favouriteRoutesRouter } from "./favouriteRoutes.js";
import { settingsRouter } from "./settings.js";

export const appRouter = router({
  system: router({
    health: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
  }),
  auth: authRouter,
  onemap: onemapRouter,
  active: activeRouter,
  lta: ltaRouter,
  mrt: mrtRouter,
  here: hereRouter,
  weather: weatherRouter,
  taxi: taxiRouter,
  sustainability: sustainabilityRouter,
  savedLocations: savedLocationsRouter,
  favouriteRoutes: favouriteRoutesRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
