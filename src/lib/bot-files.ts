import { createServerFn } from "@tanstack/react-start";

export const listBotFiles = createServerFn({ method: "GET" }).handler(async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const roots = [
    join(process.cwd(), "Bot"),
    join(process.cwd(), "Bot Dashboard", "Bot"),
    "/home/prashant/Projects/RPA BOT/Bot Dashboard/Bot",
  ];
  let dir: string | null = null;
  for (const r of roots) {
    try {
      if (readdirSync(r)) {
        dir = r;
        break;
      }
    } catch { /* ignore */ }
  }
  if (!dir) return [];
  const files = readdirSync(dir);
  return files
    .filter((f) => f.endsWith(".py") || f.endsWith(".md") || f.endsWith(".txt") || f.endsWith(".json"))
    .map((name) => {
      try {
        const st = statSync(join(dir!, name));
        return {
          name,
          path: join("Bot", name),
          size: st.size,
          mtime: st.mtime.toISOString(),
          kind: (name.endsWith(".py") ? "python" : name.endsWith(".md") ? "doc" : "config") as string,
        };
      } catch {
        return { name, path: join("Bot", name), size: 0, mtime: new Date().toISOString(), kind: "unknown" };
      }
    });
});
