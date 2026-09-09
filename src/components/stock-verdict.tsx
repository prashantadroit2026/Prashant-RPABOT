import { Badge } from "@/components/ui/badge";
import type { StockVerdict } from "@/lib/plant";
import { cn } from "@/lib/utils";

export function StockVerdictBanner({
  verdict,
  compact,
}: {
  verdict: StockVerdict;
  compact?: boolean;
}) {
  const tone = verdict.code === "stock" ? "ok" : verdict.code === "split" ? "wait" : "stop";
  return (
    <div
      className={cn(
        "rounded-lg px-3 py-2.5",
        verdict.code === "stock" && "bg-ok-soft",
        verdict.code === "split" && "bg-wait-soft",
        verdict.code === "pr" && "bg-stop-soft",
      )}
    >
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{verdict.label}</Badge>
        {!compact && (
          <span className="text-xs font-medium text-ink">{verdict.detail}</span>
        )}
      </div>
      {compact && <p className="mt-1 text-xs text-ink">{verdict.detail}</p>}
    </div>
  );
}

export function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  const w = 88;
  const h = 28;
  const max = Math.max(...values, 1);
  const pts = values
    .map((v, i) => {
      const x = values.length <= 1 ? 0 : (i / (values.length - 1)) * w;
      const y = h - 2 - (v / max) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("text-brass", className)}
      width={w}
      height={h}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}
