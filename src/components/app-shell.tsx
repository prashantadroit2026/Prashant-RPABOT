import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Bot,
  ClipboardList,
  ClipboardPen,
  Database,
  Factory,
  LogOut,
  Package,
  Warehouse,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { ROLE_LABEL } from "@/lib/plant";
import { useRole } from "@/lib/role-store";
import type { Role } from "@/lib/plant";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Raise slip", icon: ClipboardPen, roles: ["shopfloor", "store", "management"] as Role[] },
  { to: "/store", label: "Store desk", icon: Warehouse, roles: ["store", "management"] as Role[] },
  { to: "/requests", label: "Requests", icon: ClipboardList, roles: ["store", "management"] as Role[] },
  { to: "/inventory", label: "Rack", icon: Package, roles: ["store", "management"] as Role[] },
  { to: "/machines", label: "Machines", icon: Factory, roles: ["shopfloor", "store", "management"] as Role[] },
  { to: "/management", label: "Refill", icon: BarChart3, roles: ["management", "store"] as Role[] },
  { to: "/bots", label: "Bots", icon: Bot, roles: ["shopfloor", "store", "management"] as Role[] },
  { to: "/system", label: "System", icon: Database, roles: ["shopfloor", "store", "management"] as Role[] },
];

const ROLE_META: Record<Role, { label: string; hint: string }> = {
  shopfloor: { label: "Shopfloor", hint: "Raise a slip instead of sending paper" },
  store: { label: "Store", hint: "Issue from stock or raise a PR" },
  management: { label: "Management", hint: "Refill rate without the spreadsheet" },
};

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const role = useRole((s) => s.role);
  const user = useRole((s) => s.user);
  const signOut = useRole((s) => s.signOut);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    void useRole.persist.rehydrate();
  }, []);

  function handleSignOut() {
    signOut();
    void navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="flex min-w-0 items-center gap-2.5 no-underline">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brass text-paper shadow-card">
                <Warehouse className="size-4" strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-tight">
                  Procurement Hub
                </span>
                <span className="hidden truncate text-xs text-muted sm:block">
                  {ROLE_META[role].hint}
                </span>
              </span>
            </Link>
            <div className="flex items-center gap-2">
              <span className="hidden h-9 w-9 place-items-center rounded-full bg-ink text-sm font-semibold text-paper sm:grid">
                {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-right text-sm font-semibold text-ink">
                  {user?.name ?? "Guest"}
                </span>
                <span className="block text-right text-xs text-muted">
                  {user ? ROLE_LABEL[user.role] : "Signed out"}
                </span>
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-semibold text-muted transition-colors hover:border-[#6e470e]/40 hover:text-ink"
              >
                <LogOut className="size-3.5" />
                Sign out
              </button>
            </div>
          </div>
          <nav
            aria-label="Main"
            className="-mx-1 flex gap-1 overflow-x-auto pb-1"
          >
            {NAV.filter((n) => n.roles.includes(role)).map((n) => {
              const active = pathname === n.to;
              const Icon = n.icon;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cn(
                    "inline-flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium no-underline",
                    active
                      ? "bg-ink text-paper"
                      : "text-muted hover:bg-surface hover:text-ink",
                  )}
                >
                  <Icon className="size-4" />
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

export function PageHeader({
  kicker,
  title,
  subtitle,
  action,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-brass">
            {kicker}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-surface px-4 py-8 text-center text-sm text-muted">
      {children}
    </p>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "ok" | "wait" | "stop" | "brass";
}) {
  return (
    <div className="rounded-lg bg-paper p-4 shadow-card">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div
        className={cn(
          "mt-1 font-mono text-2xl font-semibold tabular-nums",
          tone === "ok" && "text-ok",
          tone === "wait" && "text-wait",
          tone === "stop" && "text-stop",
          tone === "brass" && "text-brass",
          !tone && "text-ink",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
