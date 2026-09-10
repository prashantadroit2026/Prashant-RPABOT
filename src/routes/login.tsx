import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Eye, EyeOff, KeyRound, Package, User } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { HOME_BY_ROLE } from "@/components/role-guard";
import { ROLE_LABEL } from "@/lib/plant";
import { useRole } from "@/lib/role-store";
import { USERS, findUser } from "@/lib/users";

export const Route = createFileRoute("/login")({ component: LoginPage });

const fieldClass =
  "h-11 w-full rounded-lg border border-[#ded1b8] bg-[#f8f6f0] pr-3.5 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted focus:border-[#6e470e] focus:ring-2 focus:ring-[#6e470e]/20";

function LoginPage() {
  const navigate = useNavigate();
  const user = useRole((s) => s.user);
  const signIn = useRole((s) => s.signIn);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void useRole.persist.rehydrate();
  }, []);

  if (user) return <Navigate to={HOME_BY_ROLE[user.role]} />;

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = userId.trim();
    if (!id) {
      toast.error("User ID is required.");
      return;
    }
    if (!password) {
      toast.error("Password is required.");
      return;
    }
    const account = findUser(id, password);
    if (!account) {
      toast.error("Invalid User ID or password.");
      return;
    }
    setBusy(true);
    window.setTimeout(() => {
      signIn({ userId: account.userId, name: account.name, role: account.role, department: account.department });
      toast.success(`Welcome, ${account.name} — signed in as ${ROLE_LABEL[account.role]}`);
      void navigate({ to: HOME_BY_ROLE[account.role] });
    }, 500);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-10 sm:px-6">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[560px] -translate-x-1/2 rounded-full bg-brass/5 blur-3xl" />

      <div className="relative w-full max-w-[420px]">
        <div className="rounded-2xl border border-line/60 bg-[#ffffff] px-7 py-9 shadow-[0_1px_2px_rgba(60,50,30,0.05),0_24px_60px_-28px_rgba(60,44,16,0.45)] sm:px-9 sm:py-10">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-[#5C4010] text-white shadow-[0_10px_24px_-10px_rgba(92,64,16,0.7)]">
              <Package className="size-6" strokeWidth={2} />
            </span>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">
              Procurement Hub
            </h1>
          </div>

          <form className="mt-8 flex flex-col gap-4" onSubmit={submit}>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
                User ID
              </span>
              <span className="relative block">
                <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted/70" />
                <input
                  className={`${fieldClass} pl-9`}
                  placeholder="e.g. sf.sharma"
                  autoComplete="username"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
                Password
              </span>
              <span className="relative block">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted/70" />
                <input
                  className={`${fieldClass} pl-9 pr-10`}
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted transition-colors hover:text-ink"
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#5C4010] text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(92,64,16,0.7)] transition-[transform,background-color,box-shadow] duration-150 ease-out hover:bg-[#4a340c] active:scale-[0.98] disabled:opacity-70"
            >
              {busy ? "Signing in…" : "Sign In"}
              {!busy && <ArrowRight className="size-4" />}
            </button>
          </form>

          <div className="mt-6 border-t border-line/70 pt-5">
            <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted">
              Demo accounts
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {USERS.map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  onClick={() => {
                    setUserId(u.userId);
                    setPassword(u.password);
                  }}
                  className="rounded-lg border border-line bg-surface px-2 py-2 text-center transition-colors hover:border-[#6e470e]/40 hover:bg-paper"
                >
                  <span className="block text-[11px] font-semibold text-ink">{ROLE_LABEL[u.role]}</span>
                  <span className="block font-mono text-[10px] text-muted">{u.userId}</span>
                  <span className="block font-mono text-[10px] text-muted">{u.password}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.24em] text-muted/80">
          Procurement Hub · Internal use only
        </p>
      </div>
    </main>
  );
}