import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "ok" | "wait" | "stop" | "brass";

const tones: Record<Tone, string> = {
  neutral: "bg-surface text-muted",
  ok: "bg-ok-soft text-ok",
  wait: "bg-wait-soft text-wait",
  stop: "bg-stop-soft text-stop",
  brass: "bg-brass-soft text-brass",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
