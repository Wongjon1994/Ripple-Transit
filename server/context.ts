import type * as trpcExpress from "@trpc/server/adapters/express";
import { parse as parseCookie } from "cookie";
import { SESSION_COOKIE } from "./auth.js";
import { getSessionWithUser, deleteSession } from "./db/helpers.js";
import type { User } from "../drizzle/schema.js";

export interface Context {
  req: trpcExpress.CreateExpressContextOptions["req"];
  res: trpcExpress.CreateExpressContextOptions["res"];
  user: Pick<User, "id" | "email" | "role"> | null;
  sessionId: string | null;
}

export async function createContext({
  req,
  res,
}: trpcExpress.CreateExpressContextOptions): Promise<Context> {
  const cookies = parseCookie(req.headers.cookie ?? "");
  const token = cookies[SESSION_COOKIE] ?? null;

  let user: Context["user"] = null;
  let sessionId: string | null = null;

  if (token) {
    const row = await getSessionWithUser(token);
    if (row) {
      if (row.session.expiresAt.getTime() < Date.now()) {
        // Expired — clean it up.
        await deleteSession(token);
      } else {
        sessionId = token;
        user = {
          id: row.user.id,
          email: row.user.email,
          role: row.user.role,
        };
      }
    }
  }

  return { req, res, user, sessionId };
}
