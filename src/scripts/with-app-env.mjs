import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const appEnv = (() => {
  try {
    return JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../.grok/app-env.json", import.meta.url)),
        "utf8",
      ),
    );
  } catch {
    return {};
  }
})();

for (const [key, value] of Object.entries(appEnv)) {
  if (typeof value === "string" && !Object.hasOwn(process.env, key)) {
    process.env[key] = value;
  }
}

const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: "inherit", shell: true });
child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});