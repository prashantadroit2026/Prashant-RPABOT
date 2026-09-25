import type { Role } from "@/lib/plant";

export type AppUser = {
  id: number;
  userId: string;
  name: string;
  role: Role;
  department: string;
  password: string;
  createdAt?: string;
};

export const USERS: AppUser[] = [
  {
    id: 1,
    userId: "sf.sharma",
    name: "A. Sharma",
    role: "shopfloor",
    department: "Production",
    password: "PR2026",
  },
  {
    id: 2,
    userId: "st.khan",
    name: "R. Khan",
    role: "store",
    department: "Warehouse",
    password: "PR2026",
  },
  {
    id: 3,
    userId: "mg.rao",
    name: "V. Rao",
    role: "management",
    department: "Tool Room",
    password: "PR2026",
  },
];

export function findUser(userId: string, password: string): AppUser | null {
  const id = userId.trim().toLowerCase();
  return USERS.find((u) => u.userId === id && u.password === password) ?? null;
}