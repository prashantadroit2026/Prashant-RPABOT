import { defineHandler } from "nitro";

export default defineHandler(async () => {
  return {
    ok: true,
    service: "procurement-hub",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    database: process.env.DATABASE_URL ? "neon" : "pglite",
  };
});
