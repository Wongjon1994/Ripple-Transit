import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { getAllLineStatuses } from "../db/helpers.js";

// Static reference data — Singapore MRT operating hours (approximate).
const OPERATING_HOURS: Record<
  string,
  { firstTrain: string; lastTrain: string; frequency: string; name: string }
> = {
  NS: { firstTrain: "05:31", lastTrain: "23:42", frequency: "2-3 min", name: "North-South Line" },
  EW: { firstTrain: "05:29", lastTrain: "23:57", frequency: "2-3 min", name: "East-West Line" },
  NE: { firstTrain: "05:49", lastTrain: "23:53", frequency: "2-4 min", name: "North East Line" },
  CC: { firstTrain: "05:32", lastTrain: "23:56", frequency: "3-5 min", name: "Circle Line" },
  DT: { firstTrain: "05:29", lastTrain: "23:44", frequency: "2-4 min", name: "Downtown Line" },
  TE: { firstTrain: "05:38", lastTrain: "23:48", frequency: "3-5 min", name: "Thomson-East Coast Line" },
};

export const mrtRouter = router({
  lineStatuses: publicProcedure.query(async () => {
    const rows = await getAllLineStatuses();
    return rows.map((r) => ({
      lineCode: r.lineCode,
      status: r.status,
      message: r.message ?? undefined,
      lineName: OPERATING_HOURS[r.lineCode]?.name,
      lastUpdated: r.lastUpdated.toISOString(),
    }));
  }),

  operatingHours: publicProcedure
    .input(z.object({ lineCode: z.string().optional() }).optional())
    .query(({ input }) => {
      const codes = input?.lineCode
        ? [input.lineCode]
        : Object.keys(OPERATING_HOURS);
      return codes
        .filter((c) => OPERATING_HOURS[c])
        .map((c) => ({ lineCode: c, ...OPERATING_HOURS[c] }));
    }),

  serviceAlerts: publicProcedure.query(async () => {
    const rows = await getAllLineStatuses();
    return rows
      .filter((r) => r.status !== "operational")
      .map((r) => ({
        lineCode: r.lineCode,
        alert: r.message ?? `${r.lineCode} line ${r.status}`,
        severity: (r.status === "suspended" ? "critical" : "warning") as
          | "info"
          | "warning"
          | "critical",
        timestamp: r.lastUpdated.toISOString(),
      }));
  }),
});
