import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Role } from "@/lib/plant";
import { useRole } from "@/lib/role-store";

export const HOME_BY_ROLE: Record<Role, string> = {
  shopfloor: "/",
  store: "/store",
  management: "/requests",
};

/**
 * Route guard for the client-side role session. Signed-out visitors are sent
 * to /login; a signed-in user visiting a page outside their role is redirected
 * to that role's home page.
 */
export function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const user = useRole((s) => s.user);
  if (!user) return <Navigate to="/login" />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME_BY_ROLE[user.role]} />;
  return <>{children}</>;
}