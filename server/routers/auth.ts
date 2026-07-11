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
} from "../db/helpers.js";

const credentials = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export const authRouter = router({
  // Current user (null when logged out) — safe to call publicly.
  me: publicProcedure.query(({ ctx }) => ctx.user),

  register: publicProcedure
    .input(credentials)
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
