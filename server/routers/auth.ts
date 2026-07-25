import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import {
  hashPassword,
  verifyPassword,
  newSessionToken,
  sessionExpiry,
  setSessionCookie,
  clearSessionCookie,
} from "../auth.js";
import {
  getUserByEmail,
  createUser,
  createSession,
  deleteSession,
  upsertUserPrefs,
} from "../db/helpers.js";

const credentials = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

const registration = credentials.extend({
  /** Signup consent (Phase 16): may we learn from this user's trip history?
   *  Recorded into their prefs so Insights/Flux know whether to personalise. */
  tripHistoryConsent: z.boolean().optional(),
});

export const authRouter = router({
  // Current user (null when logged out) — safe to call publicly.
  me: publicProcedure.query(({ ctx }) => ctx.user),

  register: publicProcedure
    .input(registration)
    .mutation(async ({ input, ctx }) => {
      const existing = await getUserByEmail(input.email);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with that email already exists.",
        });
      }
      const passwordHash = await hashPassword(input.password);
      const user = await createUser(input.email, passwordHash);

      // Record the trip-history consent decision made at signup (defaults to
      // false — no learning unless the user opts in). Best-effort: a prefs
      // write failure must never block account creation.
      await upsertUserPrefs(user.id, {
        tripHistoryConsent: input.tripHistoryConsent ?? false,
      }).catch(() => {});

      const token = newSessionToken();
      const expires = sessionExpiry();
      await createSession(token, user.id, expires);
      setSessionCookie(ctx.res, token, expires);

      return { id: user.id, email: user.email, role: user.role };
    }),

  login: publicProcedure
    .input(credentials)
    .mutation(async ({ input, ctx }) => {
      const user = await getUserByEmail(input.email);
      if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password.",
        });
      }
      const token = newSessionToken();
      const expires = sessionExpiry();
      await createSession(token, user.id, expires);
      setSessionCookie(ctx.res, token, expires);

      return { id: user.id, email: user.email, role: user.role };
    }),

  logout: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionId) await deleteSession(ctx.sessionId);
    clearSessionCookie(ctx.res);
    return { success: true as const };
  }),
});
