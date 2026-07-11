import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3001),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(8).default("dev-only-change-me"),

  DATABASE_URL: z.string().default("file:./data/ripple.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),

  ONEMAP_TOKEN: z.string().optional(),
  ONEMAP_EMAIL: z.string().optional(),
  ONEMAP_PASSWORD: z.string().optional(),

  LTA_ACCOUNT_KEY: z.string().optional(),

  HERE_API_KEY: z.string().optional(),
  HERE_MONTHLY_CAP: z.coerce.number().default(29950),
});

export const env = envSchema.parse(process.env);

export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
