export type BotStatus = "active" | "paused" | "error" | "draft";
export type BotType = "inventory" | "slip" | "reorder" | "report" | "generic";
export type RunStatus = "running" | "success" | "failed" | "skipped";
export type RunTrigger = "schedule" | "manual" | "api" | "webhook";
export type AlertSeverity = "info" | "warn" | "critical";

export type Bot = {
  id: number;
  code: string;
  name: string;
  description: string;
  type: BotType;
  status: BotStatus;
  cronExpr: string | null;
  config: Record<string, any>;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BotRun = {
  id: number;
  botId: number;
  botCode: string | null;
  botName: string | null;
  status: RunStatus;
  trigger: RunTrigger;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  input: Record<string, any>;
  output: Record<string, any> | null;
  error: string | null;
  createdAt: string;
};

export type Alert = {
  id: number;
  severity: AlertSeverity;
  title: string;
  message: string;
  botId: number | null;
  botCode: string | null;
  itemId: number | null;
  itemName: string | null;
  itemCode: string | null;
  acknowledged: boolean;
  createdAt: string;
};

export type AuditLog = {
  id: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, any>;
  createdAt: string;
};

export function botStatusLabel(s: BotStatus): string {
  if (s === "active") return "Active";
  if (s === "paused") return "Paused";
  if (s === "error") return "Error";
  return "Draft";
}

export function runStatusLabel(s: RunStatus): string {
  if (s === "success") return "Success";
  if (s === "failed") return "Failed";
  if (s === "running") return "Running";
  return "Skipped";
}
