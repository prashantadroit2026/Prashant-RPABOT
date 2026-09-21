import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl bg-paper p-5 shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}
