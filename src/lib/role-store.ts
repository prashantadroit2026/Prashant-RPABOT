import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Role } from "@/lib/plant";

export type SessionUser = {
  userId: string;
  name: string;
  role: Role;
  department: string;
};

type SessionState = {
  user: SessionUser | null;
  role: Role;
  signIn: (user: SessionUser) => void;
  signOut: () => void;
};

export const useRole = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      role: "shopfloor",
      signIn: (user) => set({ user, role: user.role }),
      signOut: () => set({ user: null }),
    }),
    { name: "plant-desk-role", skipHydration: true },
  ),
);