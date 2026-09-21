import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function loadAppEnv() {
  try {
    const raw = readFileSync(
      fileURLToPath(new URL("../.grok/app-env.json", import.meta.url)),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function appEnvPlugin() {
  const env = loadAppEnv();
  return {
    name: "app-builder:app-env",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__app-env", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ VITE_AUTH_ENABLED: env.VITE_AUTH_ENABLED ?? "false" }));
      });
    },
  };
}