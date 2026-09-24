import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Trash2, UserRound, Users as UsersIcon, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Kpi, PageHeader } from "@/components/app-shell";
import { RequireRole } from "@/components/role-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABEL, type Role } from "@/lib/plant";
import { useRole } from "@/lib/role-store";
import { fmtDate } from "@/lib/utils";
import { DEPARTMENTS } from "@/lib/plant";
import { createUser, deleteUser, listUsers, updateUser, type UserRow } from "@/lib/users-api";

export const Route = createFileRoute("/users")({
  component: () => (
    <RequireRole roles={["management"]}>
      <UsersPage />
    </RequireRole>
  ),
});

const ROLE_OPTIONS: Role[] = ["shopfloor", "store", "management"];

const ROLE_TONE: Record<Role, "ok" | "brass" | "wait" | "stop"> = {
  shopfloor: "wait",
  store: "ok",
  management: "brass",
};

const emptyForm = { userId: "", name: "", role: "store" as Role, department: "Warehouse", password: "" };

const inputClass =
  "h-10 w-full rounded-lg border border-[#ded1b8] bg-[#f8f6f0] px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted focus:border-[#6e470e] focus:ring-2 focus:ring-[#6e470e]/20";

function UsersPage() {
  const qc = useQueryClient();
  const me = useRole((s) => s.user);

  const users = useQuery({ queryKey: ["users"], queryFn: () => listUsers() });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", role: "store" as Role, department: "", password: "" });
  const [removingId, setRemovingId] = useState<number | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["users"] });

  const create = useMutation({
    mutationFn: (data: typeof emptyForm) => createUser({ data }),
    onSuccess: (created) => {
      toast.success(`${created.name} created — they can now sign in.`);
      setShowAdd(false);
      setForm(emptyForm);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const edit = useMutation({
    mutationFn: (data: { id: number; name: string; role: Role; department: string; password?: string }) =>
      updateUser({ data }),
    onSuccess: () => {
      toast.success("User updated.");
      setEditingId(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteUser({ data: { id } }),
    onSuccess: () => {
      toast.success("User removed.");
      setRemovingId(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function startEdit(u: UserRow) {
    setEditingId(u.id);
    setEditForm({ name: u.name, role: u.role, department: u.department, password: "" });
  }

  return (
    <AppShell>
      <PageHeader
        kicker="Access control"
        title="Users"
        subtitle="Sheet-backed accounts — create, edit or remove people who can sign in to Procurement Hub. Passwords are stored hashed; sign-in validates live against the Google Sheet."
        action={
          <Button variant="brass" size="sm" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? <X className="size-4" /> : <Plus className="size-4" />}
            {showAdd ? "Cancel" : "Add user"}
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total users" value={users.data?.length ?? "—"} hint="all roles" tone="ok" />
        {ROLE_OPTIONS.map((r) => {
          const count = users.data?.filter((u) => u.role === r).length ?? 0;
          return <Kpi key={r} label={ROLE_LABEL[r]} value={count} hint={`${count === 1 ? "account" : "accounts"}`} tone={ROLE_TONE[r]} />;
        })}
      </div>

      {showAdd && (
        <Card className="mb-6">
          <h3 className="font-semibold">New account</h3>
          <p className="mt-1 text-xs text-muted">
            User ID is lowercase letters, digits, <code className="font-mono">.</code>, <code className="font-mono">_</code>, <code className="font-mono">-</code> — minimum 6-character password.
          </p>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(form);
            }}
          >
            <label className="block">
              <Label>User ID *</Label>
              <Input
                className="font-mono"
                value={form.userId}
                onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value.toLowerCase() }))}
                placeholder="e.g. n.das"
                autoComplete="off"
              />
            </label>
            <label className="block">
              <Label>Full name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. N. Das" />
            </label>
            <label className="block">
              <Label>Role *</Label>
              <Select className={inputClass} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <Label>Department</Label>
              <Select className={inputClass} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block sm:col-span-2 lg:col-span-1">
              <Label>Password *</Label>
              <Input
                type="text"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="min 6 chars"
                autoComplete="new-password"
              />
            </label>
            <Button variant="brass" type="submit" disabled={create.isPending} className="sm:col-span-2 lg:col-span-3">
              {create.isPending ? "Creating…" : "Create user"}
            </Button>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
          <h3 className="font-semibold">
            <UserRound className="mr-1.5 inline size-4" />
            Accounts — live from the <code className="font-mono text-xs">users</code> tab
          </h3>
          <Badge tone="brass">{users.data?.length ?? 0} users</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2">User ID</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Department</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.isPending ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    Loading users…
                  </td>
                </tr>
              ) : !users.data || users.data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No users yet — create the first account above.
                  </td>
                </tr>
              ) : (
                users.data.map((u) =>
                  editingId === u.id ? (
                    <tr key={u.id} className="border-t border-line bg-paper/60">
                      <td className="px-4 py-2 font-mono text-xs font-semibold">{u.userId}</td>
                      <td className="px-4 py-2">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            edit.mutate({ id: u.id, ...editForm });
                          }}
                          className="grid grid-cols-1 gap-2 sm:min-w-[420px] sm:grid-cols-2 xl:grid-cols-[1fr_auto_auto_auto]"
                        >
                          <Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                          <Select className={inputClass} value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as Role }))}>
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </Select>
                          <Select className={inputClass} value={editForm.department} onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}>
                            {DEPARTMENTS.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </Select>
                          <span className="flex gap-2">
                            <Button size="sm" variant="brass" type="submit" disabled={edit.isPending}>
                              Save
                            </Button>
                            <Button size="sm" variant="outline" type="button" onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                          </span>
                        </form>
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                      </td>
                      <td className="px-4 py-2 text-muted">{u.department || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted">{u.createdAt ? fmtDate(u.createdAt) : "—"}</td>
                      <td className="px-4 py-2" />
                    </tr>
                  ) : (
                    <tr key={u.id} className="border-t border-line">
                      <td className="px-4 py-2 font-mono text-xs font-semibold">{u.userId}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 font-medium">
                          {u.name}
                          {me?.userId === u.userId && (
                            <Badge tone="wait">you</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                      </td>
                      <td className="px-4 py-2 text-muted">{u.department || "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted">{u.createdAt ? fmtDate(u.createdAt) : "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => startEdit(u)}>
                            <Pencil className="mr-1 size-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={me?.userId === u.userId || remove.isPending}
                            title={me?.userId === u.userId ? "You can't remove the account you're signed in with" : "Remove this user"}
                            className={me?.userId !== u.userId ? "text-stop hover:border-stop/40 hover:text-stop" : undefined}
                            onClick={() => {
                              if (removingId === u.id) {
                                remove.mutate(u.id);
                              } else {
                                setRemovingId(u.id);
                                toast.info(`Click remove again to confirm deleting ${u.userId}.`);
                              }
                            }}
                          >
                            <Trash2 className="mr-1 size-3.5" />
                            {removingId === u.id ? "Confirm" : "Remove"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line bg-surface px-5 py-3 text-xs text-muted">
          <UsersIcon className="mr-1 inline size-3.5" />
          Row 1 user id 1 seeds <code className="font-mono">sf.sharma</code>, 2 = <code className="font-mono">st.khan</code>, 3 = <code className="font-mono">mg.rao</code> — passwords are hashed in the sheet and never shown here.
        </div>
      </Card>
    </AppShell>
  );
}