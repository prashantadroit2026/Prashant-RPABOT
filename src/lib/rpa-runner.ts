// Server-only — spawns the Python RPA bot and captures output.
// Called from triggerBot when bot.code === "BOT-TCS-PRPO".

import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

export type RpaResult = {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  prNumber?: string | null;
};

function projectRoot(): string {
  // src/lib/rpa-runner.ts -> ../../
  try {
    // In dev, import.meta.url is file path; in prod, this file is bundled — fallback to process.cwd()
    const here = fileURLToPath(import.meta.url);
    return resolve(here, "..", "..", "..");
  } catch {
    return process.cwd();
  }
}

function findBotScript(): string | null {
  const candidates = [
    join(projectRoot(), "Bot", "create_pr_po.py"),
    join(process.cwd(), "Bot", "create_pr_po.py"),
    // legacy: scripts/ folder at root
    join(projectRoot(), "scripts", "create_pr_po.py"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export async function runRpaBot(opts: {
  itemCode: string;
  qty: number;
  poType?: string;
  currency?: string;
  timeoutMs?: number;
}): Promise<RpaResult> {
  const script = findBotScript();
  if (!script) {
    return {
      ok: false,
      exitCode: null,
      durationMs: 0,
      stdout: "",
      stderr: `Bot script not found. Looked in:\n${[join(projectRoot(), "Bot/create_pr_po.py"), join(process.cwd(), "Bot/create_pr_po.py")].join("\n")}`,
    };
  }

  const itemCode = String(opts.itemCode || "").trim();
  const qty = String(opts.qty || "").trim();
  if (!itemCode || !qty) {
    return { ok: false, exitCode: null, durationMs: 0, stdout: "", stderr: "itemCode and qty are required" };
  }

  const args = [script, "--item-code", itemCode, "--qty", qty];
  if (opts.poType) args.push("--po-type", String(opts.poType));
  if (opts.currency) args.push("--currency", String(opts.currency));

  const timeoutMs = opts.timeoutMs ?? 150_000; // 2.5 min — TCS is slow
  const started = Date.now();

  return await new Promise<RpaResult>((resolve) => {
    const env = {
      ...process.env,
      HEADLESS: process.env.HEADLESS ?? "true",
      // ensure unbuffered python output for streaming logs
      PYTHONUNBUFFERED: "1",
    };

    const pythonBin = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
    const child = spawn(pythonBin, args, {
      env,
      cwd: projectRoot(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch { /* ignore */ }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch { /* ignore */ }
      }, 3000);
    }, timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
      // cap at 64KB to avoid unbounded growth
      if (stdout.length > 64_000) stdout = stdout.slice(-64_000);
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        durationMs: Date.now() - started,
        stdout,
        stderr: `${stderr}\nspawn error: ${String(err)}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      const combined = `${stdout}\n${stderr}`;
      // Try to extract PR number from output (same regex as Python's capture_generated_number)
      let prNumber: string | null = null;
      const patterns = [
        /requisition\s*(?:no|number|id)?[:\s-]+([A-Za-z0-9][A-Za-z0-9\-/]*)/i,
        /([A-Z]{2,6}\s*\/\s*\d{2,4}\s*\/\s*[A-Z]{1,5}\s*\/\s*\d{3,})/,
        /([A-Z]{2,5}\s*[-\s]\s*\d{5,})/,
        /(\d{6,})/,
      ];
      for (const re of patterns) {
        const m = combined.match(re);
        if (m && /\d/.test(m[1])) {
          prNumber = m[1].trim();
          break;
        }
      }

      if (timedOut) {
        resolve({
          ok: false,
          exitCode: code,
          durationMs,
          stdout,
          stderr: `${stderr}\nTIMEOUT after ${timeoutMs}ms`,
          prNumber,
        });
        return;
      }

      const ok = code === 0;
      resolve({ ok, exitCode: code, durationMs, stdout, stderr, prNumber });
    });
  });
}

export function isRpaBot(botCode: string): boolean {
  return botCode === "BOT-TCS-PRPO" || botCode === "BOT-TCS-PR-PO";
}
