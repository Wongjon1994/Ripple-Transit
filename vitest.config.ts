import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./client/src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    root: ".",
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "client/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
