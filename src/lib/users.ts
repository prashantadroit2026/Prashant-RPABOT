import type { Role } from "@/lib/plant";

export type AppUser = {
  userId: string;
  name: string;
  role: Role;
  department: string;
  password: string;
};

export const USERS: AppUser[] = [
  {
    userId: "sf.sharma",
    name: "A. Sharma",
    role: "shopfloor",
    department: "Production",
    password: "shop@123",
  },
  {
    userId: "st.khan",
    name: "R. Khan",
    role: "store",
    department: "Warehouse",
    password: "store@123",
  },
  {
    userId: "mg.rao",
    name: "V. Rao",
    role: "management",
    department: "Tool Room",
    password: "mgmt@123",
  },
];

export function findUser(userId: string, password: string): AppUser | null {
  const id = userId.trim().toLowerCase();
  return USERS.find((u) => u.userId === id && u.password === password) ?? null;
}