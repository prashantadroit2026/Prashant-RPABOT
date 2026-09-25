import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { backendDelete, backendFetch, backendPost, backendPut } from "@/lib/backend-client";
import type { Role } from "@/lib/plant";

export type UserRow = { id: number; userId: string; name: string; role: Role; department: string; createdAt?: string };

export const listUsers = createServerFn({ method: "GET" }).handler(async () => {
  return backendFetch<UserRow[]>("/api/users");
});

const nameSchema = z.string().min(2, "Name must be at least 2 characters").max(80);
const roleSchema = z.enum(["shopfloor", "store", "management"]);
const deptSchema = z.string().max(80);
const passwordSchema = z
  .string()
  .min(6, "Password must be at least 6 characters")
  .max(100);

// Normalize the same way the backend does (trim + lowercase) BEFORE validating,
// so "Rahul.Kumar" or "  Rahul " produce a clean "rahul.kumar" instead of a
// confusing format error. Only truly invalid characters (space, @, ...) remain
// blocked, with a clear message.
const userIdSchema = z
  .string()
  .trim()
  .transform((v) => v.toLowerCase())
  .pipe(
    z
      .string()
      .min(3, "User ID must be at least 3 characters")
      .max(40)
      .regex(/^[a-z0-9._-]+$/, "User ID: lowercase letters, digits, . _ - only — no spaces"),
  );

export const createUser = createServerFn({ method: "POST" })
  .validator(
    z.object({
      userId: userIdSchema,
      name: nameSchema,
      role: roleSchema,
      department: deptSchema,
      password: passwordSchema,
    }),
  )
  .handler(async ({ data }) => {
    return backendPost<UserRow>("/api/users", data);
  });

export const updateUser = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number(),
      name: nameSchema.optional(),
      role: roleSchema.optional(),
      department: deptSchema.optional(),
      password: passwordSchema.optional(),
    }),
  )
  .handler(async ({ data }) => {
    return backendPut<UserRow>(`/api/users/${data.id}`, data);
  });

export const deleteUser = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    await backendDelete<{ ok: boolean }>(`/api/users/${data.id}`);
    return { ok: true };
  });

export const authenticateUser = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string().min(1), password: z.string().min(1) }))
  .handler(async ({ data }) => {
    return backendPost<UserRow>("/api/users/login", {
      userId: data.userId,
      password: data.password,
    });
  });